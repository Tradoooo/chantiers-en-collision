/**
 * core/errors — the error catalog of the domain (one fact, one place).
 *
 * Before this module, every service threw `new Error("free text")`: the same
 * cause was worded differently in two tools, and no client could match on a
 * stable code. The catalog below gives every cause a stable code and ONE
 * message; `fail()` interpolates the details and throws.
 *
 * The codes are part of the contract with the MCP tools: an agent reads
 * `error.code`, never the wording.
 */

export const ERROR_MESSAGES = {
  "unknown-collision": "resolve-collision: unknown collision {collisionId}",
  "override-requires-reason": "resolve-collision: override requires a reason",
  "collision-worksite-gone": "resolve-collision: worksite of the collision is gone",
  "repo-not-registered": "no repository registered for this project yet",
  "notice-path-required": "post-notice: at least one path is required",
  "notice-text-required": "post-notice: text is required",
  "notice-worksite-unknown": "post-notice: no worksite or repo for {issueKey}",
  "notice-not-found": "post-notice: nothing posted",
  "jira-access-missing": "Jira access is missing (ctx.jira.searchIssues)",
} as const;

/** The stable codes of the domain. */
export type ErrorCode = keyof typeof ERROR_MESSAGES;

/** A domain error: a stable code plus the rendered message. */
export class ChantierError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ChantierError";
    this.code = code;
  }
}

/** Render the message of a code, interpolating {placeholders}. */
export function messageFor(code: ErrorCode, details?: Record<string, string>): string {
  const template: string = ERROR_MESSAGES[code];
  if (!details) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => details[key] ?? whole);
}

/** Throw a domain error with its stable code. */
export function fail(code: ErrorCode, details?: Record<string, string>): never {
  throw new ChantierError(code, messageFor(code, details));
}
