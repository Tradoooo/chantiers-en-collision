/**
 * core/lifecycle — worksite states, dormancy, auto-close, reservation bounds
 * (spec §11). Owner: workstream D. Replace each stub; keep signatures EXACTLY.
 */

import type { Reservation, Worksite, WorksiteState } from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

/** No activity since `dormancyHours` (planned/open/active/paused only). */
export function isDormant(_w: Worksite, _now: string, _dormancyHours: number): boolean {
  throw TODO("lifecycle");
}

/** Dormant for DORMANT_CLOSE_DAYS or more → close (no ghost worksites). */
export function shouldAutoClose(_w: Worksite, _now: string): boolean {
  throw TODO("lifecycle");
}

/**
 * State after a period of inactivity or activity:
 *  - review stays review; closed stays closed
 *  - idle beyond dormancy → dormant
 *  - new activity on dormant → active
 */
export function nextActivityState(
  _w: Worksite,
  _now: string,
  _dormancyHours: number,
  _activity: boolean,
): WorksiteState {
  throw TODO("lifecycle");
}

/**
 * Reservation expiry: default DEFAULT_RESERVATION_MINUTES, clamped to
 * MAX_RESERVATION_MINUTES — nothing eternal.
 */
export function reservationExpiry(_now: string, _minutes?: number): string {
  throw TODO("lifecycle");
}

/**
 * Extend a reservation on observed activity: new expiry = now + remaining at
 * creation... keep it simple: now + original duration, still clamped to the
 * max cap from `now`.
 */
export function extendReservation(_r: Reservation, _now: string): string {
  throw TODO("lifecycle");
}
