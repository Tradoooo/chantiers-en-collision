/**
 * core/notices — rendering of the worksite mailbox (spec §9.4).
 * Owner: workstream D.
 *
 * Spec §9.4: a notice posted by a worksite reaches its neighbours through the
 * next tool response and through the hook's additionalContext. The format is
 * fixed (not an i18n sentence): one line per notice, recognisable at a glance,
 * with the sender, the words and the paths it talks about.
 *
 * No MsgId was added for this block on purpose: it is machine context injected
 * into an agent, not a user-facing sentence, so it stays locale-independent.
 * `locale` is kept in the signature for the callers that already pass it.
 */

import type { Locale, NoticeView } from "./types";

/** One line: `[PROJ-88 · agent of Léa] "text" (src/a.ts, src/b.ts)`. */
function renderLine(notice: NoticeView): string {
  const who = `[${notice.fromIssueKey} · ${notice.fromActorLabel}]`;
  const words = `"${notice.text}"`;
  const paths = `(${notice.paths.join(", ")})`;
  return `${who} ${words} ${paths}`;
}

/**
 * Render pending notices as context injected into an agent (hook
 * additionalContext / MCP verdict text). One line per notice:
 *   [PROJ-88 · agent of Léa] "renaming invoices.total to total_cents" (src/billing/**)
 * Empty string when there is nothing.
 */
export function renderNoticesForAgent(notices: NoticeView[], locale: Locale): string {
  void locale;
  if (notices.length === 0) return "";
  return notices.map(renderLine).join("\n");
}
