/**
 * tests/core/lifecycle.test.ts — worksite life and reservation bounds
 * (workstream D, spec §11). Exact boundaries: dormant at dormancyHours,
 * auto-close at DORMANT_CLOSE_DAYS, reservations clamped to [1, 1440] min.
 */

import { describe, expect, it } from "vitest";
import {
  extendReservation,
  isDormant,
  nextActivityState,
  reservationExpiry,
  shouldAutoClose,
} from "../../src/core/lifecycle";
import type { Reservation, Worksite, WorksiteState } from "../../src/core/types";
import { plusMinutes } from "../../src/testing/clock";

const T0 = "2026-11-11T09:00:00.000Z";
const HOUR = 60;
const DAY = 24 * HOUR;

function worksite(state: WorksiteState, lastActivityAt = T0): Worksite {
  return {
    id: "ws-1",
    issueKey: "PROJ-12",
    repoId: "repo-1",
    accountId: "acc-lea",
    kind: "human",
    state,
    openedAt: T0,
    lastActivityAt,
  };
}

function reservation(createdAt: string, expiresAt: string): Reservation {
  return {
    id: "res-1",
    worksiteId: "ws-1",
    repoId: "repo-1",
    patterns: ["src/billing/**"],
    hard: false,
    createdAt,
    expiresAt,
  };
}

describe("isDormant", () => {
  it("falls dormant exactly at dormancyHours, not one minute before", () => {
    const w = worksite("active");
    expect(isDormant(w, plusMinutes(T0, 24 * HOUR - 1), 24)).toBe(false);
    expect(isDormant(w, plusMinutes(T0, 24 * HOUR), 24)).toBe(true);
    expect(isDormant(w, plusMinutes(T0, 48 * HOUR), 24)).toBe(true);
  });

  it("honours a custom dormancyHours", () => {
    const w = worksite("open");
    expect(isDormant(w, plusMinutes(T0, 6 * HOUR), 6)).toBe(true);
    expect(isDormant(w, plusMinutes(T0, 5 * HOUR), 6)).toBe(false);
  });

  it("only applies to planned / open / active / paused", () => {
    const now = plusMinutes(T0, 100 * HOUR);
    expect(isDormant(worksite("planned"), now, 24)).toBe(true);
    expect(isDormant(worksite("paused"), now, 24)).toBe(true);
    for (const state of ["review", "dormant", "closed"] as WorksiteState[]) {
      expect(isDormant(worksite(state), now, 24)).toBe(false);
    }
  });
});

describe("shouldAutoClose", () => {
  it("closes a dormant worksite at DORMANT_CLOSE_DAYS exactly", () => {
    const w = worksite("dormant");
    expect(shouldAutoClose(w, plusMinutes(T0, 7 * DAY - 1))).toBe(false);
    expect(shouldAutoClose(w, plusMinutes(T0, 7 * DAY))).toBe(true);
  });

  it("never closes a worksite that is not dormant", () => {
    const now = plusMinutes(T0, 30 * DAY);
    for (const state of ["planned", "open", "active", "paused", "review"] as WorksiteState[]) {
      expect(shouldAutoClose(worksite(state), now)).toBe(false);
    }
  });
});

describe("nextActivityState", () => {
  it("keeps closed and review untouched", () => {
    const now = plusMinutes(T0, 100 * HOUR);
    expect(nextActivityState(worksite("closed"), now, 24, true)).toBe("closed");
    expect(nextActivityState(worksite("review"), now, 24, true)).toBe("review");
    expect(nextActivityState(worksite("review"), now, 24, false)).toBe("review");
  });

  it("wakes paused / open / dormant / planned on activity", () => {
    const now = plusMinutes(T0, 100 * HOUR);
    expect(nextActivityState(worksite("dormant"), now, 24, true)).toBe("active");
    expect(nextActivityState(worksite("paused"), now, 24, true)).toBe("active");
    expect(nextActivityState(worksite("open"), now, 24, true)).toBe("active");
    expect(nextActivityState(worksite("active"), now, 24, true)).toBe("active");
    expect(nextActivityState(worksite("planned"), now, 24, true)).toBe("open");
  });

  it("falls dormant after dormancy without activity", () => {
    expect(nextActivityState(worksite("active"), plusMinutes(T0, 24 * HOUR), 24, false)).toBe(
      "dormant",
    );
    expect(nextActivityState(worksite("active"), plusMinutes(T0, 23 * HOUR), 24, false)).toBe(
      "active",
    );
    expect(nextActivityState(worksite("planned"), plusMinutes(T0, 30 * HOUR), 24, false)).toBe(
      "dormant",
    );
  });

  it("leaves an already dormant worksite dormant while idle", () => {
    expect(nextActivityState(worksite("dormant"), plusMinutes(T0, 2 * HOUR), 24, false)).toBe(
      "dormant",
    );
  });
});

describe("reservationExpiry", () => {
  it("defaults to DEFAULT_RESERVATION_MINUTES (120)", () => {
    expect(reservationExpiry(T0)).toBe(plusMinutes(T0, 120));
  });

  it("clamps to [1, MAX_RESERVATION_MINUTES = 1440]", () => {
    expect(reservationExpiry(T0, 1440)).toBe(plusMinutes(T0, 1440));
    expect(reservationExpiry(T0, 1440 * 10)).toBe(plusMinutes(T0, 1440));
    expect(reservationExpiry(T0, 0)).toBe(plusMinutes(T0, 1));
    expect(reservationExpiry(T0, -50)).toBe(plusMinutes(T0, 1));
  });

  it("keeps a valid requested duration", () => {
    expect(reservationExpiry(T0, 45)).toBe(plusMinutes(T0, 45));
  });
});

describe("extendReservation", () => {
  it("renews the original duration from now", () => {
    const r = reservation(T0, plusMinutes(T0, 120));
    expect(extendReservation(r, plusMinutes(T0, 600))).toBe(plusMinutes(T0, 720));
  });

  it("still clamps to the max cap from now", () => {
    const r = reservation(T0, plusMinutes(T0, 5000));
    expect(extendReservation(r, plusMinutes(T0, 100))).toBe(plusMinutes(T0, 1540));
  });
});
