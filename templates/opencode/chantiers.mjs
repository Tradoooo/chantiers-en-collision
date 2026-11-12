/**
 * chantiers.mjs — the OpenCode plugin that makes an OpenCode session visible
 * to the "Chantiers en collision" app (Jira Forge).
 *
 * WHAT IT DOES (one POST per event, on the app's `ingest` web trigger):
 *   - session start  -> POST <BASE>/open   {sessionRef, branch, cwd}
 *   - before a write -> POST <BASE>/touch  {session_id, tool_input.file_path, …}
 *   - session end    -> POST <BASE>/close  {sessionRef, reason}
 *
 * The real OpenCode plugin API (v2, `opencode --version` = 2.1.1) is used here:
 *   - `ctx.event.subscribe({types, signal})` for the session lifecycle,
 *   - `ctx.permission.hook("evaluate", cb)` — the ONLY place where OpenCode
 *     lets a plugin refuse an action (`event.effect = "deny"`, `event.message`),
 *   - `ctx.tool.hook("execute.before", cb)` for the write tools,
 *   - `ctx.session.hook("context", cb)` to inject the app's verdict in the
 *     agent's context (the plugin's `additionalContext`).
 * A plugin is a default export with an `id` and a `setup(ctx)` function.
 *
 * FAIL-OPEN (SPEC §20): every network call has a 3 s timeout (1.5 s for
 * /close), every error is swallowed, and the agent is never blocked except by
 * an explicit `permissionDecision: "deny"` coming back from the app.
 *
 * CONFIG (env, then plugin options, then defaults):
 *   CHANTIER_URL     base web-trigger URL, WITHOUT the route (required)
 *   CHANTIER_TOKEN   personal Bearer token (required; identity = the token)
 *   CHANTIER_REPO    repo slug, e.g. acme/billing
 *   CHANTIER_SESSION session reference (default: one per plugin process)
 *
 * PRIVACY: only paths are sent. No file content ever leaves the machine.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
import * as lib from "./chantiers-lib.mjs";

/** Timeout of a /open or /touch call, in ms. */
const FETCH_MS = 3000;
/** Timeout of the best-effort /close call, in ms. */
const CLOSE_MS = 1500;
/** How long a verdict is reused for the same file (permission + tool hooks). */
const CACHE_MS = 60000;
/** Every line the plugin prints starts with this prefix. */
const PREFIX = "[chantier]";

/**
 * Print a line the pilot can grep for.
 *
 * `console.error` on purpose: the OpenCode CLI owns stdout for the answer of
 * the agent, so a plugin's `console.log` is swallowed there. stderr reaches
 * the terminal (and `--print-logs`).
 */
function log(message) {
  console.error(`${PREFIX} ${message}`);
}

/** A trimmed env var, or "" when unset. */
function envText(name) {
  const value = process.env[name];
  return value === undefined ? "" : value.trim();
}

/** A trimmed string option, or "" when unset. */
function optionText(options, name) {
  const value = options[name];
  return typeof value === "string" ? value.trim() : "";
}

/** Default session reference: stable for the life of the process. */
function defaultSession() {
  return `oc-${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`;
}

/** The current git branch of `cwd`, or "unknown" outside a repository. */
function gitBranch(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? "unknown" : out;
  } catch {
    return "unknown";
  }
}

/**
 * The plugin configuration: env wins over plugin options, options win over
 * the built-in defaults.
 */
function readConfig(ctx) {
  const options = ctx?.options !== undefined && typeof ctx.options === "object" ? ctx.options : {};
  const cwd = typeof ctx?.location?.directory === "string" ? ctx.location.directory : process.cwd();
  const base = (envText("CHANTIER_URL") || optionText(options, "url")).replace(/\/+$/, "");
  const token = envText("CHANTIER_TOKEN") || optionText(options, "token");
  const repo = envText("CHANTIER_REPO") || optionText(options, "repo");
  const session = envText("CHANTIER_SESSION") || optionText(options, "session") || defaultSession();
  return { base, token, repo, session, cwd };
}

/**
 * POST {base}/{route} with a hard timeout. Never throws: on any error the
 * plugin simply continues without the app.
 *
 * @returns {Promise<object|undefined>} the parsed body, or undefined
 */
async function post(cfg, route, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
    };
    if (cfg.repo !== "") headers["x-chantier-repo"] = cfg.repo;
    const res = await fetch(`${cfg.base}/${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (raw.trim() === "") return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------- the plugin ----- */

/** Close the worksite, best effort (1.5 s, never throws). */
async function closeWorksite(cfg, reason) {
  try {
    await post(cfg, "close", lib.buildCloseBody(cfg.session, reason), CLOSE_MS);
  } catch {
    /* best effort */
  }
}

/** A short, safe description of an error. */
function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** What the hooks share: the worksite state, the verdicts, the queue. */
function createState() {
  return { opened: false, opening: undefined, verdicts: new Map(), pending: [] };
}

/** Open the worksite once per process. Never retried (fail-open). */
async function ensureOpen(cfg, state) {
  if (state.opened) return;
  if (state.opening !== undefined) {
    await state.opening;
    return;
  }
  state.opening = (async () => {
    const branch = gitBranch(cfg.cwd);
    const ticket = lib.ticketKeyOf(branch);
    const json = await post(cfg, "open", lib.buildOpenBody(cfg.session, branch, cfg.cwd), FETCH_MS);
    state.opened = true;
    const verdict = lib.parseHookResponse(json);
    if (verdict.context) log(`open ${branch}${ticket === undefined ? "" : ` (${ticket})`}: ${verdict.context}`);
    if (verdict.deny) log(`DENY open ${branch}: ${verdict.reason}`);
  })().catch(() => undefined);
  await state.opening;
}

/** Report a file to the app; the verdict is reused for a short while. */
async function touch(cfg, state, filePath) {
  const cached = state.verdicts.get(filePath);
  if (cached !== undefined && Date.now() - cached.at < CACHE_MS) return cached;
  const json = await post(cfg, "touch", lib.buildTouchBody(cfg.session, filePath, cfg.cwd), FETCH_MS);
  const entry = { at: Date.now(), verdict: lib.parseHookResponse(json), logged: false };
  state.verdicts.set(filePath, entry);
  if (state.verdicts.size > 200) state.verdicts.delete(state.verdicts.keys().next().value);
  return entry;
}

/** Absolute path of a file, the way the app records it. */
function absolutePath(cfg, filePath) {
  return isAbsolute(filePath) ? filePath : resolve(cfg.cwd, filePath);
}

/** Show a verdict once: on stderr for the pilot, and in the agent context. */
function announce(state, filePath, verdict) {
  if (verdict.context === undefined) return;
  const entry = state.verdicts.get(filePath);
  if (entry !== undefined && entry.logged === true) return;
  if (entry !== undefined) entry.logged = true;
  const line = `${filePath}: ${verdict.context}`;
  log(line);
  state.pending.push(line);
}

/**
 * Permission hook — the only place where OpenCode lets a plugin refuse an
 * action. It runs on every edit decision, before the tool call is allowed.
 */
async function onPermission(cfg, state, event) {
  try {
    if (event?.action !== "edit") return;
    const resources = Array.isArray(event.resources) ? event.resources : [];
    if (resources.length === 0) return;
    await ensureOpen(cfg, state);
    for (const resource of resources.slice(0, 5)) {
      const filePath = absolutePath(cfg, resource);
      const entry = await touch(cfg, state, filePath);
      if (entry.verdict.deny === true) {
        event.effect = "deny";
        event.message = entry.verdict.reason;
        log(`DENY ${filePath}: ${entry.verdict.reason}`);
        return;
      }
      announce(state, filePath, entry.verdict);
    }
  } catch (error) {
    log(`permission hook ignored an error: ${errorText(error)}`);
  }
}

/** Tool hook — catches every write tool, even an ungated one. */
async function onToolBefore(cfg, state, event) {
  try {
    const filePath = lib.extractFilePath(event?.tool, event?.input);
    if (filePath === undefined) return;
    await ensureOpen(cfg, state);
    const target = absolutePath(cfg, filePath);
    const entry = await touch(cfg, state, target);
    if (entry.verdict.deny === true) {
      log(`DENY ${target}: ${entry.verdict.reason} (refused by the app; blocking happens in the permission hook)`);
      return;
    }
    announce(state, target, entry.verdict);
  } catch (error) {
    log(`tool hook ignored an error: ${errorText(error)}`);
  }
}

/**
 * Context hook — the plugin's equivalent of `additionalContext`: the verdicts
 * collected on the way are injected into the next model request, so the agent
 * itself reads them.
 */
function onContext(state, event) {
  try {
    if (state.pending.length === 0) return;
    const text = state.pending.splice(0, state.pending.length).join("\n\n");
    if (Array.isArray(event?.system)) event.system.push({ type: "text", text: `${PREFIX} ${text}` });
    else log(text);
  } catch {
    /* fail-open */
  }
}

/** Follow the session lifecycle: open on the first run, close on shutdown. */
async function watchEvents(cfg, state, stream) {
  try {
    for await (const event of stream) {
      if (event?.type === "session.execution.started") await ensureOpen(cfg, state);
      else if (event?.type === "location.shutdown") await closeWorksite(cfg, "opencode-location-shutdown");
    }
  } catch {
    /* the stream ends with the server */
  }
}

/**
 * The plugin. A default export with an `id` and a `setup(ctx)` function is
 * what the OpenCode v2 runtime reads — no `@opencode/plugin` import needed.
 */
export default {
  id: "chantiers",
  async setup(ctx) {
    const cfg = readConfig(ctx);
    if (cfg.base === "" || cfg.token === "") {
      log("disabled — CHANTIER_URL and CHANTIER_TOKEN are required");
      return undefined;
    }
    const state = createState();
    await ctx.permission?.hook?.("evaluate", (event) => onPermission(cfg, state, event));
    await ctx.tool?.hook?.("execute.before", (event) => onToolBefore(cfg, state, event));
    await ctx.session?.hook?.("context", (event) => onContext(state, event));
    const controller = new AbortController();
    const stream = ctx.event?.subscribe?.({
      types: ["session.execution.started", "location.shutdown"],
      signal: controller.signal,
    });
    if (stream !== undefined) void watchEvents(cfg, state, stream);
    log(`enabled — session ${cfg.session} on ${cfg.cwd}`);
    return async () => {
      controller.abort();
      await closeWorksite(cfg, "opencode-plugin-unload");
    };
  },
};
