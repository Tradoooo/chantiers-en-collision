import { describe, expect, it } from "vitest";
import { computeDegree, hasThirdPartyReservation } from "../../src/core/degrees";
import type { FootprintEntry, Reservation, Zone } from "../../src/core/types";

const NOW = "2026-11-11T12:00:00.000Z";

let seq = 0;
function entry(over: Partial<FootprintEntry> = {}): FootprintEntry {
  seq += 1;
  return {
    worksiteId: "ws-1",
    path: "src/billing/invoice.ts",
    kind: "file",
    source: "declared",
    mode: "edit",
    firstAt: NOW,
    lastAt: NOW,
    ...over,
  };
}

function zone(nature: Zone["nature"], name = "z"): Zone {
  seq += 1;
  return { id: `zone-${seq}`, repoId: "r1", name, patterns: ["**"], nature };
}

function base(over: Partial<Parameters<typeof computeDegree>[0]> = {}) {
  return {
    entryA: entry(),
    entryB: entry({ worksiteId: "ws-2" }),
    zone: undefined,
    frozen: false,
    reservedByOther: false,
    neighborDormant: false,
    predictedOnly: false,
    ...over,
  };
}

describe("computeDegree raw degrees", () => {
  it("same file is D2", () => {
    expect(computeDegree(base()).degree).toBe(2);
    expect(computeDegree(base()).rawDegree).toBe(2);
  });

  it("same file with a delete or rename is D3", () => {
    expect(computeDegree(base({ entryB: entry({ worksiteId: "ws-2", mode: "delete" }) })).degree).toBe(3);
    expect(computeDegree(base({ entryA: entry({ mode: "rename" }) })).degree).toBe(3);
    expect(computeDegree(base({ entryA: entry({ mode: "create" }), entryB: entry({ worksiteId: "ws-2", mode: "edit" }) })).degree).toBe(2);
  });

  it("dir containing the other's file is D2 (spec §22.1), dir vs dir is D1", () => {
    const contained = computeDegree(
      base({
        entryA: entry({ path: "src/billing", kind: "dir" }),
        entryB: entry({ worksiteId: "ws-2" }),
      }),
    );
    expect(contained.degree).toBe(2);
    const dirVsDir = computeDegree(
      base({
        entryA: entry({ path: "src/billing", kind: "dir" }),
        entryB: entry({ worksiteId: "ws-2", path: "src/billing", kind: "dir" }),
      }),
    );
    expect(dirVsDir.degree).toBe(1);
  });

  it("exclusive zone is D4", () => {
    const r = computeDegree(base({ zone: zone("exclusive", "migrations") }));
    expect(r.degree).toBe(4);
  });

  it("frozen zone is D4", () => {
    expect(computeDegree(base({ frozen: true })).degree).toBe(4);
  });

  it("reservation by a third worksite is D4", () => {
    expect(computeDegree(base({ reservedByOther: true })).degree).toBe(4);
  });
});

describe("computeDegree modulations", () => {
  it("hotspot lowers one step", () => {
    const r = computeDegree(base({ zone: zone("hotspot", "locales") }));
    expect(r.rawDegree).toBe(2);
    expect(r.degree).toBe(1);
  });

  it("dormant neighbour lowers one step", () => {
    const r = computeDegree(base({ neighborDormant: true }));
    expect(r.degree).toBe(1);
    expect(r.rawDegree).toBe(2);
  });

  it("hotspot + dormant lower two steps, never below D0", () => {
    const r = computeDegree(
      base({
        zone: zone("hotspot"),
        neighborDormant: true,
        entryA: entry({ path: "src/billing", kind: "dir" }),
        entryB: entry({ worksiteId: "ws-2", path: "src/billing", kind: "dir" }),
      }),
    );
    expect(r.rawDegree).toBe(1);
    expect(r.degree).toBe(0);
  });

  it("prediction-only caps at D1 with probable flag", () => {
    const r = computeDegree(base({ predictedOnly: true }));
    expect(r.degree).toBe(1);
    expect(r.rawDegree).toBe(2);
    expect(r.probable).toBe(true);
    const low = computeDegree(
      base({
        predictedOnly: true,
        entryA: entry({ path: "src/billing", kind: "dir" }),
        entryB: entry({ worksiteId: "ws-2" }),
      }),
    );
    expect(low.degree).toBe(1);
    expect(low.probable).toBe(true);
  });
});

describe("hasThirdPartyReservation", () => {
  function reservation(over: Partial<Reservation> = {}): Reservation {
    seq += 1;
    return {
      id: `res-${seq}`,
      worksiteId: "ws-3",
      repoId: "r1",
      patterns: ["db/migrations/**"],
      hard: false,
      createdAt: NOW,
      expiresAt: "2026-11-11T14:00:00.000Z",
      ...over,
    };
  }
  const pair: [string, string] = ["ws-1", "ws-2"];

  it("active third-party reservation covering the path", () => {
    expect(hasThirdPartyReservation([reservation()], pair, "db/migrations/0042.sql", NOW)).toBe(true);
  });

  it("ignores the pair's own reservations", () => {
    expect(
      hasThirdPartyReservation([reservation({ worksiteId: "ws-1" })], pair, "db/migrations/0042.sql", NOW),
    ).toBe(false);
  });

  it("ignores expired or released reservations", () => {
    expect(
      hasThirdPartyReservation([reservation({ expiresAt: "2026-11-11T11:00:00.000Z" })], pair, "db/migrations/0042.sql", NOW),
    ).toBe(false);
    expect(
      hasThirdPartyReservation([reservation({ releasedAt: NOW })], pair, "db/migrations/0042.sql", NOW),
    ).toBe(false);
  });

  it("ignores reservations not covering the path", () => {
    expect(hasThirdPartyReservation([reservation()], pair, "src/billing/invoice.ts", NOW)).toBe(false);
  });

  it("matches plain paths and dir patterns", () => {
    expect(
      hasThirdPartyReservation([reservation({ patterns: ["package-lock.json"] })], pair, "package-lock.json", NOW),
    ).toBe(true);
    expect(
      hasThirdPartyReservation([reservation({ patterns: ["db/migrations"] })], pair, "db/migrations/0042.sql", NOW),
    ).toBe(true);
  });
});
