/**
 * core/collisions — overlap detection between worksites (spec §7, §17).
 * Owner: workstream B. Replace each stub; keep signatures EXACTLY.
 */

import type {
  Collision,
  CollisionDraft,
  CollisionPhase,
  FootprintEntry,
  Reservation,
  Worksite,
  Zone,
} from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

export interface WorksiteWithEntries {
  worksite: Worksite;
  entries: FootprintEntry[];
}

export interface DetectOptions {
  zones: Zone[];
  reservations: Reservation[];
  now: string;
  hardMode: boolean;
}

/**
 * Detect collisions between `subject` and every other worksite.
 * Rules:
 *  - out-of-scope paths are ignored entirely
 *  - one collision per pair of worksites AND per zone (spec §17 step 5);
 *    keep the worst degree per (pair, zone), representative path = worst entry
 *  - normalized ordering worksiteA < worksiteB (by worksite id)
 *  - two sessions of the same pilot get NO discount (spec §7)
 *  - degree via computeDegree (hotspot/dormant/predicted modulations)
 */
export function detectCollisions(
  _subject: WorksiteWithEntries,
  _others: WorksiteWithEntries[],
  _opts: DetectOptions,
): CollisionDraft[] {
  throw TODO("collisions");
}

/**
 * Phase of a collision (spec §13 four numbers):
 *  - "pr" if either worksite is in review or has prOpen
 *  - "before-code" if both sides are prediction-only (planned state or all
 *    entries predicted)
 *  - "live" otherwise
 * ("missed" is never produced here — it comes from real conflicts.)
 */
export function phaseFor(_a: Worksite, _b: Worksite, _predictedOnly: boolean): CollisionPhase {
  throw TODO("collisions");
}

/** Convenience: the worst collision of a list, or undefined. */
export function worstCollision(_collisions: Collision[]): Collision | undefined {
  throw TODO("collisions");
}
