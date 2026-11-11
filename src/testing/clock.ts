/**
 * testing/clock — controllable clock for tests and simulations.
 * Owner: orchestrator (frozen). Do not modify.
 */

export interface TestClock {
  now(): string;
  /** Advance by `minutes` (may be negative). */
  advance(minutes: number): void;
  /** Set an absolute ISO time. */
  set(iso: string): void;
}

export function makeClock(startIso = "2026-11-11T09:00:00.000Z"): TestClock {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t).toISOString(),
    advance: (minutes: number) => {
      t += minutes * 60_000;
    },
    set: (iso: string) => {
      t = new Date(iso).getTime();
    },
  };
}

/** ISO string `minutes` after `from`. */
export function plusMinutes(from: string, minutes: number): string {
  return new Date(new Date(from).getTime() + minutes * 60_000).toISOString();
}

/** Minutes elapsed between two ISO timestamps (floored, ≥ 0). */
export function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
}
