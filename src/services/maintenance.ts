/**
 * services/maintenance — the two guarantees of spec §11 (CC-17):
 * no eternal reservation, no ghost worksite.
 * Owner: workstream H. Replace stubs; keep signatures EXACTLY.
 *
 * sweep (scheduledTrigger fiveMinute):
 *  - idle worksites → dormant (after rules.dormancyHours)
 *  - dormant ≥ DORMANT_CLOSE_DAYS → closed (pilot notified before via event)
 *  - expired reservations released; neighbours in queue get "free"
 * dailyJobs (scheduledTrigger day):
 *  - refresh predictions for open tickets (ctx.jira.mergedHistory)
 *  - compare predicted vs attested footprints of merged worksites
 *    (prediction accuracy, spec §13)
 */

import type { Ctx } from "./ctx";

export interface SweepResult {
  dormant: string[];
  closed: string[];
  expiredReservations: string[];
  released: string[];
}

export async function sweep(_ctx: Ctx): Promise<SweepResult> {
  throw new Error("TODO(maintenance): not implemented — see docs/CONTRACTS.md");
}

export async function dailyJobs(
  _ctx: Ctx,
): Promise<{ predictions: number; accuracyComputed: number }> {
  throw new Error("TODO(maintenance): not implemented — see docs/CONTRACTS.md");
}
