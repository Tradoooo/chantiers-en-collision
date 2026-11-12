/**
 * chantiers-lib.mjs — the PURE core of the OpenCode plugin `chantiers`.
 *
 * Everything here is a pure function over plain data: no I/O, no network, no
 * import of anything but the standard library. The plugin (`chantiers.mjs`)
 * does the I/O and calls these helpers; the unit tests import this file only.
 *
 * The shapes below are the ones the app's `ingest` web trigger expects
 * (docs/PROTOCOL.md §1, docs/WATCHER.md):
 *   POST <BASE>/open   { sessionRef, branch, cwd }
 *   POST <BASE>/touch  { session_id, tool_input: { file_path }, cwd,
 *                        hook_event_name: "PreToolUse" }
 *   POST <BASE>/close  { sessionRef, reason? }
 * The answer is the hook JSON of the app:
 *   { hookSpecificOutput: { hookEventName, additionalContext?,
 *                            permissionDecision: "deny",
 *                            permissionDecisionReason } }
 */

/** Tools that write to the filesystem. `bash` is deliberately absent. */
export const WRITE_TOOLS = Object.freeze(["write", "edit", "multiedit", "patch"]);

/** Argument keys a write tool may use to carry the file path. */
export const PATH_KEYS = Object.freeze(["filePath", "file_path", "path"]);

/** The only hook event name the app knows for a file touch. */
export const TOUCH_EVENT_NAME = "PreToolUse";

/** Ticket key inside a branch name: PROJ-123, ABC-9 … (uppercase only). */
const TICKET_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/**
 * The path a write tool is about to touch, or undefined.
 *
 * @param {string} toolName  the tool id ("write", "edit", "bash", …)
 * @param {unknown} args     the tool arguments (the tool hook's `input`)
 * @returns {string|undefined} the path, exactly as the tool gave it
 */
export function extractFilePath(toolName, args) {
  if (typeof toolName !== "string" || !WRITE_TOOLS.includes(toolName)) return undefined;
  if (!args || typeof args !== "object") return undefined;
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * The ticket key carried by a branch name, or undefined.
 *
 * `feature/PROJ-123-x` -> "PROJ-123";  `main` -> undefined.
 *
 * @param {string} branch
 * @returns {string|undefined}
 */
export function ticketKeyOf(branch) {
  if (typeof branch !== "string" || branch === "") return undefined;
  const match = branch.match(TICKET_KEY);
  return match === null ? undefined : match[1];
}

/**
 * Body of the `/open` route: the session opens a worksite.
 *
 * @param {string} sessionRef
 * @param {string} branch    current git branch ("unknown" if not a repo)
 * @param {string} cwd       working directory of the session
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
 * Read the app's answer to a hook call.
 *
 * Accepts the raw body (string) or an already parsed object. Anything that
 * is not understood yields `{}` — the caller then simply continues.
 *
 * @param {unknown} json
 * @returns {{context?: string, deny?: boolean, reason?: string}}
 */
export function parseHookResponse(json) {
  const raw = typeof json === "string" ? safeParse(json) : json;
  if (!raw || typeof raw !== "object") return {};
  const hook = raw.hookSpecificOutput;
  const out = hook && typeof hook === "object" ? hook : raw;
  const result = {};
  if (typeof out.additionalContext === "string" && out.additionalContext.trim() !== "") {
    result.context = out.additionalContext;
  }
  if (out.permissionDecision === "deny") {
    result.deny = true;
    result.reason =
      typeof out.permissionDecisionReason === "string" && out.permissionDecisionReason.trim() !== ""
        ? out.permissionDecisionReason
        : "edit blocked by the app";
  }
  return result;
}

/** JSON.parse that never throws. */
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
/* --- PART 1 --- */
