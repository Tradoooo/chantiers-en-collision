/**
 * core/degrees — collision degree D0..D5 and its modulations (spec §7).
 * Owner: workstream B. Replace each stub; keep signatures EXACTLY.
 */

import type { Degree, FootprintEntry, Reservation, Zone } from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

export interface DegreeInput {
  entryA: FootprintEntry;
  entryB: FootprintEntry;
  /** Zone resolved for the overlapping path (undefined = ordinary). */
  zone?: Zone;
  /** Zone is frozen right now. */
  frozen: boolean;
  /** An active reservation by a THIRD worksite covers the path. */
  reservedByOther: boolean;
  /** The neighbouring worksite is dormant. */
  neighborDormant: boolean;
  /** At least one side is prediction-only. */
  predictedOnly: boolean;
}

export interface DegreeResult {
  /** Degree after modulation. */
  degree: Degree;
  /** Degree before modulation. */
  rawDegree: Degree;
  /** True when capped to D1 because a side is prediction-only. */
  probable: boolean;
}

/**
 * Raw degrees:
 *  - D4: exclusive zone, frozen zone, or active reservation by a third worksite
 *  - D3: same file and either mode is delete/rename (moved/renamed counts)
 *  - D2: same file
 *  - D1: same directory (one contains the other, different files)
 *  - D0: same named zone, different files
 * Modulations: hotspot → one step down; dormant neighbour → one step down;
 * prediction-only → capped at D1 with probable = true. Never below D0.
 */
export function computeDegree(_input: DegreeInput): DegreeResult {
  throw TODO("degrees");
}

/** True when an active reservation of ANOTHER worksite overlaps the path. */
export function hasThirdPartyReservation(
  _reservations: Reservation[],
  _worksiteIds: [string, string],
  _path: string,
): boolean {
  throw TODO("degrees");
}
