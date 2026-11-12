/**
 * chantiers-lib/payload.mjs — the ONE place that builds the payloads the
 * "Chantiers en collision" app expects on its `ingest` web trigger.
 *
 * Every client that reports an observation to the app builds its request body
 * here, never by hand:
 *   - the generic watcher    templates/watcher/chantier-watch.mjs  (imports)
 *   - the OpenCode plugin    templates/opencode/chantiers-lib.mjs  (re-exports)
 *   - the CI templates       templates/ci/*  (shell; see note below)
 *
 * Hook contract (docs/PROTOCOL.md §1, docs/WATCHER.md):
 *   POST <BASE>/open   { sessionRef, branch, cwd }
 *   POST <BASE>/touch  { session_id, tool_input: { file_path }, cwd,
 *                        hook_event_name: "PreToolUse" }
 *   POST <BASE>/close  { sessionRef, reason? }
 * Headers: Authorization: Bearer <token>, and X-Chantier-Repo when the repo is
 * known. The app's answer is the hook JSON the client prints/injects.
 *
 * CI speaks a different route family — /ci/footprint and /ci/conflict — with an
 * attested-footprint shape (`repoSlug`, `branch`, `baseBranch`, `issueKey`,
 * `files`; then `issueKey`, `repoSlug`, `paths`). Its runners ship git+curl but
 * not necessarily node, so those templates stay in shell and cannot `import`
 * this file; the shapes they must emit are documented here as the canonical
 * reference. The path list they send is exactly what joinPaths() below
 * produces (one path per line).
 *
 * Zero npm dependencies: node builtins only.
 */

import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

/** The only hook event name the app knows for a file touch. */
export const TOUCH_EVENT_NAME = "PreToolUse";

/**
 * Body of the `/open` route: the session opens a worksite.
 *
 * @param {string} sessionRef
 * @param {string} branch  current git branch ("unknown" if not a repo)
 * @param {string} cwd     working directory of the session
 */
export function buildOpenBody(sessionRef, branch, cwd) {
  return { sessionRef, branch, cwd };
}

/**
 * Body of the `/touch` route: one file is about to be written.
 *
 * @param {string} sessionRef
 * @param {string} filePath  the path only — never the file content
 * @param {string} cwd
 */
export function buildTouchBody(sessionRef, filePath, cwd) {
  return {
    session_id: sessionRef,
    tool_input: { file_path: filePath },
    cwd,
    hook_event_name: TOUCH_EVENT_NAME,
  };
}

/**
 * Body of the `/close` route: the session releases its worksite.
 *
 * @param {string} sessionRef
 * @param {string} [reason]
 */
export function buildCloseBody(sessionRef, reason) {
  const body = { sessionRef };
  if (typeof reason === "string" && reason.trim() !== "") body.reason = reason;
  return body;
}

/**
 * One path per line (docs/PROTOCOL.md §1 "one path per line"): the shape the
 * app's `lines()` sanitizer accepts for a path list, and exactly what the CI
 * `/ci/conflict` `paths` field sends. Accepts an array of paths or a string
 * (already newline-separated); trims lines and drops blanks.
 *
 * @param {string[] | string | undefined} paths
 * @returns {string} a newline-joined list of non-empty, trimmed paths
 */
export function joinPaths(paths) {
  const list = Array.isArray(paths) ? paths : String(paths ?? "").split("\n");
  return list
    .map((entry) => String(entry).trim())
    .filter((entry) => entry !== "")
    .join("\n");
}

/**
 * The headers every hook POST shares: Bearer auth always, `content-type`, and
 * `x-chantier-repo` only when a slug is known and non-empty.
 *
 * @param {string} token      personal Bearer token (identity = the token)
 * @param {string} [repoSlug] repo slug, e.g. "acme/billing"
 */
export function buildHookHeaders(token, repoSlug) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  if (typeof repoSlug === "string" && repoSlug.trim() !== "") {
    headers["x-chantier-repo"] = repoSlug.trim();
  }
  return headers;
}

/**
 * Default session reference: stable for the life of a process. A prefix lets a
 * client keep its own session namespace (the OpenCode plugin uses "oc-").
 *
 * @param {string} [prefix]
 * @returns {string} e.g. "oc-host-name-1234-ab12cd34"
 */
export function defaultSession(prefix = "") {
  return `${prefix}${hostname()}-${process.pid}-${randomBytes(4).toString("hex")}`;
}

/**
 * The canonical timeouts, so that the doc, the watcher and the OpenCode plugin
 * never disagree. A cold Forge web trigger can take several seconds — 10 s and
 * ONE retry is the floor that still leaves the agent unblocked.
 */
export const FETCH_TIMEOUT_MS = 10000;
/** SessionEnd / close is fire-and-forget: a short budget is enough. */
export const CLOSE_TIMEOUT_MS = 1500;

/**
 * POST {base}/{route} and parse the JSON answer, with ONE retry (the web
 * trigger is fail-open and can cold-start beyond the timeout). Never throws:
 * returns `undefined` on any error — the client keeps working either way.
 *
 * @param {string} base   ingest base URL, WITHOUT the trailing route
 * @param {string} route  "open" | "touch" | "close" | …
 * @param {object} body   the request body (already the right shape)
 * @param {{token: string, repo?: string, timeoutMs?: number}} [opts]
 */
export async function postJson(base, route, body, { token, repo, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const url = `${String(base).replace(/\/+$/, "")}/${route}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: buildHookHeaders(token, repo),
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