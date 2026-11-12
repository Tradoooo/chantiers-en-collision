#!/usr/bin/env node
/**
 * chantier-watch.mjs — the universal "chantier-watch" watcher (SPEC §19,
 * IDEAS.md #6/#26): makes ANY agent or editor visible to the app with no
 * native hook. It watches a worktree (fs events) and reports to the `ingest`
 * web trigger (/open, /touch, /close). Zero npm dependencies, Node >= 18.
 *
 * PASSIVE & FAIL-OPEN (SPEC §20): it only observes — it never locks or blocks
 * the write being watched. Any network/JSON error is logged discreetly and
 * swallowed; failures never crash it and never stop the tool. Only the app can
 * refuse an edit, and only in hard mode.
 *
 * Config (env):
 *   CHANTIER_URL         base web-trigger URL, WITHOUT the route (required)
 *   CHANTIER_TOKEN       personal Bearer token (required; identity = the token)
 *   CHANTIER_REPO        repo slug (default: parsed from `git remote get-url`)
 *   CHANTIER_SESSION     session ref (default: hostname-pid-random at start)
 *   CHANTIER_WATCH_DIR   dir to watch (default: cwd)
 *   CHANTIER_DEBOUNCE_MS debounce per file, ms (default: 2000)
 *
 * Usage:
 *   node chantier-watch.mjs              watch ./ (daemon)
 *   node chantier-watch.mjs --selftest   self-check, prints "SELFTEST OK"
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOUCH_EVENT_NAME,
  buildCloseBody,
  buildHookHeaders,
  buildOpenBody,
  buildTouchBody,
  defaultSession,
} from "../chantiers-lib/payload.mjs";

const IGNORED_SEGMENTS = new Set([".git", "node_modules", "dist", ".chantier"]);
/** The app answers in ~1 s when warm, but a cold web trigger can take longer. */
const FETCH_MS = 10000;
const CLOSE_MS = 1500;

/* ---------------------------------------------------------- config ------ */

function envText(name, fallback = "") {
  const v = process.env[name];
  return v === undefined ? fallback : v.trim();
}

function gitOut(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** `acme/billing` from a git remote origin URL, in any common shape. */
function repoFromRemote(url) {
  if (!url) return "";
  let slug = url;
  if (url.includes("@") && url.includes(":")) slug = url.slice(url.indexOf(":") + 1);
  else if (url.includes("://")) slug = url.slice(url.indexOf("://") + 3).replace(/^[^/]*\//, "");
  return slug.replace(/\.git$/, "");
}

function readConfig() {
  const watchDir = resolve(envText("CHANTIER_WATCH_DIR") || process.cwd());
  const parsed = Number.parseInt(envText("CHANTIER_DEBOUNCE_MS", "2000"), 10);
  const repo = envText("CHANTIER_REPO") || repoFromRemote(gitOut(watchDir, ["remote", "get-url", "origin"]));
  return {
    base: envText("CHANTIER_URL").replace(/\/+$/, ""),
    token: envText("CHANTIER_TOKEN"),
    repo,
    session: envText("CHANTIER_SESSION") || defaultSession(),
    watchDir,
    debounceMs: Number.isFinite(parsed) && parsed > 0 ? parsed : 2000,
  };
}

/* ---------------------------------------------------------- http -------- */

/** POST {base}/{route} with a hard timeout. Never throws: returns undefined. */
async function post(cfg, route, body, timeoutMs) {
  // A cold Forge web trigger can take longer than the timeout: one retry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = buildHookHeaders(cfg.token, cfg.repo);
      const res = await fetch(`${cfg.base}/${route}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!raw.trim()) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    } catch {
      if (attempt === 1) return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

/** Print the useful part of a hook response on stdout, prefixed and visible. */
function report(label, json) {
  if (!json || typeof json !== "object") return;
  const out = json.hookSpecificOutput;
  if (!out || typeof out !== "object") return;
  if (typeof out.additionalContext === "string" && out.additionalContext.trim()) {
    console.log(`[chantier] ${label}: ${out.additionalContext.trim()}`);
  }
  if (out.permissionDecision === "deny") {
    console.log(`[chantier] DENY ${label}: ${out.permissionDecisionReason ?? "edit blocked"}`);
  }
}

/* ---------------------------------------------------- fs watching ------- */

function isIgnored(root, file) {
  const rel = relative(root, file);
  if (rel.startsWith("..")) return false;
  return rel.split(/[\\/]/).some((seg) => IGNORED_SEGMENTS.has(seg));
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Every sub-directory under root, skipping the ignored segments. */
function childDirs(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || IGNORED_SEGMENTS.has(e.name)) continue;
      const full = join(dir, e.name);
      out.push(full);
      walk(full);
    }
  };
  walk(root);
  return out;
}

/** Manual per-directory fallback (Node 18 on Linux has no recursive watch). */
function watchTree(root, onFile) {
  const watchers = new Map();
  const add = (dir) => {
    if (watchers.has(dir)) return;
    try {
      watchers.set(dir, watch(dir, (_evt, name) => {
        onFile(name ? join(dir, name) : dir);
        if (name && isDir(join(dir, name))) for (const d of childDirs(root)) add(d);
      }));
    } catch {
      /* best effort */
    }
  };
  add(root);
  for (const d of childDirs(root)) add(d);
  return () => {
    for (const w of watchers.values()) w.close();
  };
}

function startWatcher(root, onFile) {
  try {
    const w = watch(root, { recursive: true }, (_evt, name) => onFile(name ? resolve(root, name) : root));
    return () => w.close();
  } catch {
    return watchTree(root, onFile);
  }
}

/* ---------------------------------------------------- the three routes -- */

function touch(cfg, file) {
  const body = buildTouchBody(cfg.session, file, cfg.watchDir);
  return post(cfg, "touch", body, FETCH_MS).then((json) => {
    if (json !== undefined) report(`touch ${relative(cfg.watchDir, file)}`, json);
  });
}

function open(cfg) {
  const branch = gitOut(cfg.watchDir, ["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
  const body = buildOpenBody(cfg.session, branch, cfg.watchDir);
  return post(cfg, "open", body, FETCH_MS).then((json) => {
    if (json !== undefined) report(`open ${branch}`, json);
  });
}

function close(cfg, reason) {
  return post(cfg, "close", buildCloseBody(cfg.session, reason), CLOSE_MS);
}

/* ---------------------------------------------------------- main -------- */

async function main() {
  const cfg = readConfig();
  if (!cfg.base || !cfg.token) {
    console.error("[chantier] disabled: CHANTIER_URL and CHANTIER_TOKEN are required");
    process.exit(0);
  }
  const timers = new Map();
  let stopped = false;
  let stop = () => {};
  const shutdown = async (reason) => {
    if (stopped) return;
    stopped = true;
    stop();
    try {
      await close(cfg, reason);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // Start watching first so no write between startup and `open` is missed.
  stop = startWatcher(cfg.watchDir, (file) => {
    if (isIgnored(cfg.watchDir, file)) return;
    const prev = timers.get(file);
    if (prev) clearTimeout(prev);
    timers.set(file, setTimeout(() => {
      timers.delete(file);
      void touch(cfg, file);
    }, cfg.debounceMs));
  });
  await open(cfg);
}

/* ------------------------------------------------------- selftest ------- */

function waitFor(pred, timeoutMs) {
  const started = Date.now();
  return new Promise((done) => {
    const tick = () => {
      if (pred()) return done(true);
      if (Date.now() - started >= timeoutMs) return done(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}

/** SIGINT the child and resolve with its exit code (SIGKILL fallback). */
function stopChild(child) {
  return new Promise((done) => {
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      done(-1);
    }, 3000);
    child.once("exit", (code) => {
      clearTimeout(killTimer);
      done(code ?? -1);
    });
    child.kill("SIGINT");
  });
}

function startTestServer() {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      requests.push({ route: (req.url ?? "").split("?")[0].replace(/\/+$/, ""), headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hookSpecificOutput: { hookEventName: TOUCH_EVENT_NAME, additionalContext: "selftest context" } }));
    });
  });
  return { requests, server };
}

function initTestRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "chantier-selftest-"));
  const git = (args) => gitOut(repoRoot, args);
  git(["init", "-q"]);
  git(["config", "user.email", "selftest@example.com"]);
  git(["config", "user.name", "chantier selftest"]);
  writeFileSync(join(repoRoot, "seed.txt"), "hello\n");
  git(["add", "seed.txt"]);
  git(["commit", "-q", "-m", "seed"]);
  return repoRoot;
}

function spawnTestChild(repoRoot, baseUrl, session) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CHANTIER_URL: baseUrl,
      CHANTIER_TOKEN: "selftest-token",
      CHANTIER_REPO: "acme/selftest",
      CHANTIER_SESSION: session,
      CHANTIER_WATCH_DIR: repoRoot,
      CHANTIER_DEBOUNCE_MS: "150",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const buf = [];
  child.stdout.on("data", (c) => buf.push(String(c)));
  child.stderr.on("data", (c) => buf.push(String(c)));
  return { child, out: () => buf.join("") };
}

async function runSelftest(live) {
  const { requests, repoRoot, baseUrl, session } = live;
  const problems = [];
  const check = (ok, msg) => {
    if (!ok) problems.push(msg);
  };
  const { child, out } = spawnTestChild(repoRoot, baseUrl, session);
  try {
    check(await waitFor(() => requests.some((r) => r.route.endsWith("/open")), 4000), "no /open received");
    const target = join(repoRoot, "touched.txt");
    writeFileSync(target, "v1\n");
    writeFileSync(target, "v2\n");
    check(await waitFor(() => requests.some((r) => r.route.endsWith("/touch")), 4000), "no /touch received");
    check((await stopChild(child)) === 0, "child did not exit 0 on SIGINT");
    check(await waitFor(() => requests.some((r) => r.route.endsWith("/close")), 2000), "no /close received");

    const openReq = requests.find((r) => r.route.endsWith("/open"));
    const touchReq = requests.find((r) => r.route.endsWith("/touch"));
    const closeReq = requests.find((r) => r.route.endsWith("/close"));
    check(openReq && openReq.body.sessionRef === session, "/open sessionRef mismatch");
    check(openReq && typeof openReq.body.branch === "string" && openReq.body.branch !== "", "/open branch missing");
    check(openReq && openReq.body.cwd === repoRoot, "/open cwd mismatch");
    check(openReq && openReq.headers["x-chantier-repo"] === "acme/selftest", "/open X-Chantier-Repo missing");
    check(touchReq && touchReq.body.session_id === session, "/touch session_id mismatch");
    check(touchReq && touchReq.body.tool_input?.file_path === target, "/touch file_path mismatch");
    check(touchReq && touchReq.body.cwd === repoRoot, "/touch cwd mismatch");
    check(closeReq && closeReq.body.sessionRef === session, "/close sessionRef mismatch");
    check(out().includes("[chantier]"), "hook response not printed on stdout");
  } finally {
    if (!child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  return problems;
}

/**
 * Self-contained proof: ephemeral HTTP server + temp git repo + a real child
 * process. Verifies /open then /touch are received with the right fields and
 * the hook response lands on stdout. Prints "SELFTEST OK", exits 0.
 */
async function selftest() {
  const { requests, server } = startTestServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}/ingest`;
  const repoRoot = initTestRepo();
  const session = "chantier-selftest-session";
  let problems;
  try {
    problems = await runSelftest({ requests, baseUrl, repoRoot, session });
  } catch (err) {
    problems = [`unexpected: ${err}`];
  }
  try {
    server.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(repoRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (problems.length) {
    for (const p of problems) console.error(`SELFTEST FAIL: ${p}`);
    process.exit(1);
  }
  console.log("SELFTEST OK");
  process.exit(0);
}

if (process.argv.includes("--selftest")) {
  void selftest();
} else {
  void main();
}