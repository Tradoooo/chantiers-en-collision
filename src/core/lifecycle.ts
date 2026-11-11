/**
 * core/lifecycle — worksite states, dormancy, auto-close, reservation bounds
 * (spec §11). Owner: workstream D.
 *
 * Spec §11: no eternal footprint (default 2 h, 24 h max, extended by observed
 * activity, released on expiry) and no ghost worksite (a worksite without
 * activity falls dormant after `dormancyHours`, then closes itself after
 * DORMANT_CLOSE_DAYS).
 */

import {
  DEFAULT_RESERVATION_MINUTES,
  DORMANT_CLOSE_DAYS,
  MAX_RESERVATION_MINUTES,
} from "./types";
import type { Reservation, Worksite, WorksiteState } from "./types";

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * 60;

/** States that can fall dormant: work in progress, never review/closed. */
const DORMANT_CANDIDATES: ReadonlySet<WorksiteState> = new Set<WorksiteState>([
  "planned",
  "open",
  "active",
  "paused",
]);

function minutesSince(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
}

function plusMinutes(from: string, minutes: number): string {
  return new Date(new Date(from).getTime() + minutes * 60_000).toISOString();
}

/** No activity since `dormancyHours` (planned/open/active/paused only). */
export function isDormant(w: Worksite, now: string, dormancyHours: number): boolean {
  if (!DORMANT_CANDIDATES.has(w.state)) return false;
  return minutesSince(w.lastActivityAt, now) >= dormancyHours * MINUTES_PER_HOUR;
}

/** Dormant for DORMANT_CLOSE_DAYS or more → close (no ghost worksites). */
export function shouldAutoClose(w: Worksite, now: string): boolean {
  if (w.state !== "dormant") return false;
  return minutesSince(w.lastActivityAt, now) >= DORMANT_CLOSE_DAYS * MINUTES_PER_DAY;
}

/** State reached on activity: a dormant/paused/open site resumes working. */
function activeState(w: Worksite): WorksiteState {
  if (w.state === "planned") return "open";
  if (w.state === "dormant" || w.state === "paused" || w.state === "open") return "active";
  return w.state;
}

/**
 * State after a period of inactivity or activity:
 *  - review stays review; closed stays closed
 *  - idle beyond dormancy → dormant
 *  - new activity on dormant → active
 */
export function nextActivityState(
  w: Worksite,
  now: string,
  dormancyHours: number,
  activity: boolean,
): WorksiteState {
  if (w.state === "closed" || w.state === "review") return w.state;
  if (activity) return activeState(w);
  return isDormant(w, now, dormancyHours) ? "dormant" : w.state;
}

/** Clamp a requested reservation duration into [1, MAX] minutes. */
function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_RESERVATION_MINUTES;
  const rounded = Math.floor(minutes);
  return Math.min(MAX_RESERVATION_MINUTES, Math.max(1, rounded));
}

/**
 * Reservation expiry: default DEFAULT_RESERVATION_MINUTES, clamped to
 * MAX_RESERVATION_MINUTES — nothing eternal.
 */
export function reservationExpiry(now: string, minutes?: number): string {
  return plusMinutes(now, clampMinutes(minutes ?? DEFAULT_RESERVATION_MINUTES));
}

/**
 * Extend a reservation on observed activity: new expiry = now + the original
 * duration, still clamped to the max cap from `now` (nothing eternal).
 */
export function extendReservation(r: Reservation, now: string): string {
  const original = Math.max(1, Math.floor(minutesSince(r.createdAt, r.expiresAt)));
  return reservationExpiry(now, original);
}
