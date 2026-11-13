/**
 * core/time — the ONE source of ISO-8601 time arithmetic.
 *
 * Services never call Date.now() directly: they go through these helpers (or
 * an injected clock, `Ctx.now`). Keeping them here means the services, the UI,
 * the glue and the storage layer share one definition; `src/testing/clock`
 * stays the controllable clock used by tests only (frozen, never production).
 */

/** Current time as an ISO-8601 string — the single place "now" is read. */
export function nowISO(): string {
  return new Date().toISOString();
}

/** ISO string `minutes` after `from` (a negative value shifts back). */
export function plusMinutes(from: string, minutes: number): string {
  return new Date(new Date(from).getTime() + minutes * 60_000).toISOString();
}

/** Whole minutes elapsed between two ISO timestamps (floored, never negative). */
export function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
}