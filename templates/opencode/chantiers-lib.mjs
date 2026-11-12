/**
 * chantiers-lib.mjs — the PURE core of the OpenCode plugin `chantiers`.
 *
 * Everything here is a pure function over plain data: no I/O, no network, no
 * import of anything but the standard library. The plugin (`chantiers.mjs`)
 * does the I/O and calls these helpers; the unit tests import this file only.
 *
 * The bodies of the `ingest` web trigger routes (/open, /touch, /close) are
 * NOT defined here any more: they live in the shared module
 * `templates/chantiers-lib/payload.mjs` — the one place where the shape of an
 * emitted emprise is written down — and are re-exported below. The watcher
 * imports the very same module, so both clients speak one protocol.
 *
 * What stays here is what is specific to the plugin:
 *   - the write tools it watches, and the path they carry,
 *   - the ticket key carried by a branch name,
 *   - the reading of the app's answer (the hook JSON of spec §9.3):
 *     { hookSpecificOutput: { hookEventName, additionalContext?,
 *                             permissionDecision: "deny",
 *                             permissionDecisionReason } }
 */

export {
  TOUCH_EVENT_NAME,
  buildCloseBody,
  buildHookHeaders,
  buildOpenBody,
  buildTouchBody,
  defaultSession,
  joinPaths,
} from "../chantiers-lib/payload.mjs";

/** Tools that write to the filesystem. `bash` is deliberately absent. */
export const WRITE_TOOLS = Object.freeze(["write", "edit", "multiedit", "patch"]);

/** Argument keys a write tool may use to carry the file path. */
export const PATH_KEYS = Object.freeze(["filePath", "file_path", "path"]);

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
