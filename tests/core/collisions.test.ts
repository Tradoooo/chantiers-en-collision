import { describe, expect, it } from "vitest";
import { detectCollisions, phaseFor, worstCollision } from "../../src/core/collisions";
import type { WorksiteWithEntries } from "../../src/core/collisions";
import { DEFAULT_ZONE_CATALOG } from "../../src/core/zones";
import type { Collision, FootprintEntry, Worksite, Zone } from "../../src/core/types";

const NOW = "2026-11-11T12:00:00.000Z";

let seq = 0;
function worksite(over: Partial<Worksite> = {}): Worksite {
  seq += 1;
  return {
    id: `ws-${seq}`,
    issueKey: `PROJ-${100 + seq}`,
    repoId: "r1",
    accountId: `user-${seq}@example.com`,
    kind: "agent",
    state: "open",
    openedAt: NOW,
    lastActivityAt: NOW,
    ...over,
  };
}

function kindOf(path: string): FootprintEntry["kind"] {
  if (/[*?]/.test(path)) return "pattern";
  const last = path.split("/").pop() ?? "";
  return last.includes(".") ? "file" : "dir";
}

function entry(w: Worksite, path: string, over: Partial<FootprintEntry> = {}): FootprintEntry {
  return {
    worksiteId: w.id,
    path,
    kind: kindOf(path),
    source: "declared",
    mode: "edit",
    firstAt: NOW,
    lastAt: NOW,
    ...over,
  };
}

function catalog(): Zone[] {
  return DEFAULT_ZONE_CATALOG.map((e, i) => ({
    id: `cat-${i}`,
    repoId: "r1",
    name: e.name,
    patterns: e.patterns,
    nature: e.nature,
  }));
}

function side(w: Worksite, paths: [string, Partial<FootprintEntry>?][]): WorksiteWithEntries {
  return { worksite: w, entries: paths.map(([p, o]) => entry(w, p, o)) };
}

const opts = { zones: catalog(), reservations: [], now: NOW, hardMode: false };

describe("detectCollisions", () => {
  it("same file yields one D2 draft with normalized pair ordering", () => {
    const a = side(worksite({ id: "ws-b" }), [["src/billing/invoice.ts"]]);
    const b = side(worksite({ id: "ws-a" }), [["src/billing/invoice.ts"]]);
    const drafts = detectCollisions(a, [b], opts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.degree).toBe(2);
    expect(drafts[0]!.worksiteA).toBe("ws-a");
    expect(drafts[0]!.worksiteB).toBe("ws-b");
    expect(drafts[0]!.path).toBe("src/billing/invoice.ts");
  });

  it("dir vs file inside yields D2 (declared dir covers every file)", () => {
    const a = side(worksite(), [["src/billing"]]);
    const b = side(worksite(), [["src/billing/invoice.ts"]]);
    const drafts = detectCollisions(a, [b], opts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.degree).toBe(2);
  });

  it("exclusive zone escalates to D4", () => {
    const a = side(worksite(), [["db/migrations/0042_a.sql"]]);
    const b = side(worksite(), [["db/migrations/0042_a.sql"]]);
    const drafts = detectCollisions(a, [b], opts);
    expect(drafts[0]!.degree).toBe(4);
    expect(drafts[0]!.zoneId).toBeDefined();
  });

  it("one draft per pair and zone — worst degree kept", () => {
    const a = side(worksite(), [
      ["src/billing/invoice.ts"],
      ["src/billing/tax.ts"],
      ["db/migrations/0042.sql"],
    ]);
    const b = side(worksite(), [
      ["src/billing/invoice.ts"],
      ["db/migrations/0043.sql"],
    ]);
    const drafts = detectCollisions(a, [b], opts);
    // no named zone on src/billing → one keyless draft (D2) + one migrations draft (D4)
    expect(drafts).toHaveLength(2);
    const migrations = drafts.find((d) => d.zoneId !== undefined);
    expect(migrations?.degree).toBe(4);
  });

  it("out-of-scope paths are ignored", () => {
    const a = side(worksite(), [["dist/bundle.js"]]);
    const b = side(worksite(), [["dist/bundle.js"]]);
    expect(detectCollisions(a, [b], opts)).toHaveLength(0);
  });

  it("same pilot gets no discount", () => {
    const acct = "lea@example.com";
    const a = side(worksite({ accountId: acct }), [["src/billing/invoice.ts"]]);
    const b = side(worksite({ accountId: acct }), [["src/billing/invoice.ts"]]);
    const drafts = detectCollisions(a, [b], opts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.degree).toBe(2);
  });

  it("closed and self worksites are skipped", () => {
    const me = side(worksite({ id: "ws-x" }), [["src/a.ts"]]);
    const closed = side(worksite({ state: "closed" }), [["src/a.ts"]]);
    expect(detectCollisions(me, [closed, me], opts)).toHaveLength(0);
  });

  it("D0 for a shared named zone without overlap", () => {
    const zones = [
      ...catalog(),
      { id: "team-billing", repoId: "r1", name: "billing", patterns: ["src/billing/**"], nature: "ordinary" as const },
    ];
    const a = side(worksite(), [["src/billing/invoice.ts"]]);
    const b = side(worksite(), [["src/billing/tax.ts"]]);
    const drafts = detectCollisions(a, [b], { ...opts, zones });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.degree).toBe(0);
    expect(drafts[0]!.zoneId).toBe("team-billing");
  });

  it("no D0 added when the zone already has a stronger collision", () => {
    const zones = [
      ...catalog(),
      { id: "team-billing", repoId: "r1", name: "billing", patterns: ["src/billing/**"], nature: "ordinary" as const },
    ];
    const a = side(worksite(), [["src/billing/invoice.ts"]]);
    const b = side(worksite(), [["src/billing/invoice.ts"], ["src/billing/tax.ts"]]);
    const drafts = detectCollisions(a, [b], { ...opts, zones });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.degree).toBe(2);
  });

  it("two different migration files still collide D4 (exclusive zone)", () => {
    const a = side(worksite(), [["db/migrations/0042_rename_total.sql"]]);
    const b = side(worksite(), [["db/migrations/0043_add_index.sql"]]);
    const drafts = detectCollisions(a, [b], opts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.degree).toBe(4);
    expect(drafts[0]!.path).toBe("db/migrations/0043_add_index.sql");
  });

  it("prediction-only side caps to D1 with probable", () => {
    const a = side(worksite({ state: "planned" }), [["src/billing/invoice.ts", { source: "predicted" }]]);
    const b = side(worksite(), [["src/billing/invoice.ts"]]);
    const drafts = detectCollisions(a, [b], opts);
    expect(drafts[0]!.degree).toBe(1);
    expect(drafts[0]!.rawDegree).toBe(2);
    expect(drafts[0]!.probable).toBe(true);
    expect(drafts[0]!.phase).toBe("before-code");
  });
});

describe("phaseFor", () => {
  it("pr when a PR is open, before-code when predicted, live otherwise", () => {
    const a = worksite();
    const b = worksite();
    expect(phaseFor(a, b, false)).toBe("live");
    expect(phaseFor({ ...b, prOpen: true }, a, false)).toBe("pr");
    expect(phaseFor({ ...b, state: "review" }, a, false)).toBe("pr");
    expect(phaseFor(a, b, true)).toBe("before-code");
  });
});

describe("worstCollision", () => {
  it("picks the highest degree", () => {
    const base = {
      id: "c", repoId: "r1", worksiteA: "a", worksiteB: "b", path: "p",
      rawDegree: 1 as const, phase: "live" as const, state: "open" as const, detectedAt: NOW,
    };
    const list: Collision[] = [
      { ...base, id: "c1", degree: 1 },
      { ...base, id: "c2", degree: 4, rawDegree: 4 },
      { ...base, id: "c3", degree: 2 },
    ];
    expect(worstCollision(list)?.id).toBe("c2");
    expect(worstCollision([])).toBeUndefined();
  });
});
