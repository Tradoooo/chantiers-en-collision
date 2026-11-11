/**
 * core/notices — rendering of the worksite mailbox (spec §9.4).
 * Owner: workstream D. Replace each stub; keep signatures EXACTLY.
 */

import type { Locale, NoticeView } from "./types";

/**
 * Render pending notices as context injected into an agent (hook
 * additionalContext / MCP verdict text). One line per notice:
 *   [PROJ-88 · agent of Léa] "renaming invoices.total to total_cents" (src/billing/**)
 * Empty string when there is nothing.
 */
export function renderNoticesForAgent(_notices: NoticeView[], _locale: Locale): string {
  throw new Error("TODO(notices): not implemented — see docs/CONTRACTS.md");
}
