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