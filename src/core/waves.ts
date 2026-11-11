/**
 * core/waves — plan-parallel-work (spec §9.5).
 * Owner: workstream C. Replace each stub; keep signatures EXACTLY.
 */

import type { PlanTicket, WavePlan, Zone } from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

export interface PlanOptions {
  zones: Zone[];
  /** Max waves before giving up (default 50). */
  maxWaves?: number;
}

/**
 * Split tickets into collision-free waves:
 *  1. build a graph linking tickets colliding at D2+ OR sharing an exclusive
 *     resource (entriesOverlap + zoneForPath from core/paths and core/zones);
 *  2. hinge tickets = highest graph degree (ties → higher ticket priority);
 *     they go ALONE in wave 0, first;
 *  3. remaining tickets are packed by priority into waves of at most
 *     `workers` tickets, never two linked tickets in the same wave;
 *  4. watchPairs = pairs overlapping only through a hotspot zone (same
 *     translations file etc.) — overlap expected, worth a look;
 *  5. confidence: low when most tickets lack components or footprints,
 *     medium when some do, high otherwise (confidenceNote explains).
 */
export function planWaves(_tickets: PlanTicket[], _workers: number, _opts: PlanOptions): WavePlan {
  throw TODO("waves");
}
