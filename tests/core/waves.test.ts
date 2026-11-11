import { describe, expect, it } from "vitest";
import { classifyPath } from "../../src/core/paths";
import type { PlanTicket, Zone } from "../../src/core/types";
import { planWaves } from "../../src/core/waves";
import { DEFAULT_ZONE_CATALOG } from "../../src/core/zones";

/** The catalog as a repo would hold it (spec §6). */
const zones: Zone[] = DEFAULT_ZONE_CATALOG.map((entry) => ({
  id: `zone-${entry.name}`,
  repoId: "repo-1",
  name: entry.name,
  patterns: [...entry.patterns],
  nature: entry.nature,
}));

interface TicketSpec {
  paths: string[];
  components?: string[];
  priorityRank?: number;
  dueAt?: string;
}

function ticket(issueKey: string, spec: TicketSpec): PlanTicket {
  return {
    issueKey,
    components: spec.components ?? ["billing"],
    ...(spec.priorityRank !== undefined ? { priorityRank: spec.priorityRank } : {}),
    ...(spec.dueAt !== undefined ? { dueAt: spec.dueAt } : {}),
    entries: spec.paths.map((path) => ({
      path,
      kind: classifyPath(path),
      source: "predicted" as const,
    })),
  };
}

const MIGRATIONS = "db/migrations";
const I18N_FILE = "src/i18n/messages.ts";

/** The six tickets of spec §9.5, with footprints that match the story. */
function specExample(): PlanTicket[] {
  return [
    ticket("PROJ-88", { paths: ["src/billing/invoice.ts", MIGRATIONS], priorityRank: 2 }),
    ticket("PROJ-90", { paths: ["src/billing"], priorityRank: 1 }),
    ticket("PROJ-93", { paths: ["src/billing/report.ts", I18N_FILE], priorityRank: 3 }),
    ticket("PROJ-95", { paths: ["src/billing/rates.ts", I18N_FILE], priorityRank: 4 }),
    ticket("PROJ-97", { paths: ["src/reports/summary.ts"], components: [], priorityRank: 7 }),
    ticket("PROJ-101", {
      paths: ["db/migrations/0042_add_total_cents.sql"],
      components: [],
      priorityRank: 5,
    }),
  ];
}

/** Every ticket appears exactly once across the waves. */
function expectAllTicketsOnce(waves: string[][], tickets: PlanTicket[]): void {
  const flat = waves.flat().sort();
  expect(flat).toEqual(tickets.map((t) => t.issueKey).sort());
}

describe("planWaves — spec §9.5 example", () => {
  const tickets = specExample();
  const plan = planWaves(tickets, 3, { zones });

  it("puts the hinge alone in wave 0", () => {
    expect(plan.hinges).toEqual(["PROJ-90"]);
    expect(plan.waves[0]).toEqual(["PROJ-90"]);
  });

  it("packs the rest by priority, never two linked tickets together", () => {
    expect(plan.waves).toEqual([
      ["PROJ-90"],
      ["PROJ-88", "PROJ-93", "PROJ-95"],
      ["PROJ-101", "PROJ-97"],
    ]);
    expectAllTicketsOnce(plan.waves, tickets);
  });

  it("keeps PROJ-101 out of PROJ-88's wave (shared migrations zone)", () => {
    const waveOf = (key: string) => plan.waves.findIndex((wave) => wave.includes(key));
    expect(waveOf("PROJ-101")).toBeGreaterThan(waveOf("PROJ-88"));
  });

  it("flags the hotspot-only pair instead of blocking it", () => {
    expect(plan.watchPairs).toEqual([
      { a: "PROJ-93", b: "PROJ-95", why: `same hotspot file ${I18N_FILE}` },
    ]);
  });

  it("never exceeds the worker count in a wave", () => {
    for (const wave of plan.waves) expect(wave.length).toBeLessThanOrEqual(3);
  });

  it("reports the confidence and says why", () => {
    expect(plan.confidence).toBe("medium");
    expect(plan.confidenceNote).toBe("2 tickets without a component");
  });
});

describe("planWaves — graph shape", () => {
  it("links two tickets sharing one exclusive resource", () => {
    const tickets = [
      ticket("PROJ-1", { paths: [MIGRATIONS] }),
      ticket("PROJ-2", { paths: ["db/migrations/0043_x.sql"] }),
    ];
    const plan = planWaves(tickets, 5, { zones });
    expect(plan.hinges).toEqual([]);
    expect(plan.waves).toEqual([["PROJ-1"], ["PROJ-2"]]);
  });

  it("links two tickets on the same file", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["src/core/a.ts"] }),
      ticket("PROJ-2", { paths: ["src/core/a.ts"] }),
    ];
    const plan = planWaves(tickets, 5, { zones });
    expect(plan.waves).toEqual([["PROJ-1"], ["PROJ-2"]]);
    expect(plan.watchPairs).toEqual([]);
  });

  it("links through a file inside the other ticket's directory", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["src/core"] }),
      ticket("PROJ-2", { paths: ["src/core/deep/b.ts"] }),
    ];
    expect(planWaves(tickets, 5, { zones }).waves).toEqual([["PROJ-1"], ["PROJ-2"]]);
  });

  it("does not link two unrelated directories", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["src/core"] }),
      ticket("PROJ-2", { paths: ["src/ui/pane.tsx"] }),
    ];
    expect(planWaves(tickets, 5, { zones }).waves).toEqual([["PROJ-1", "PROJ-2"]]);
  });

  it("treats a frozen zone as an exclusive resource", () => {
    const frozen: Zone = {
      id: "zone-freeze",
      repoId: "repo-1",
      name: "freeze release",
      patterns: ["src/frozen/**"],
      nature: "frozen",
      frozenFrom: "2026-11-01T00:00:00.000Z",
      frozenTo: "2026-11-30T00:00:00.000Z",
    };
    const tickets = [
      ticket("PROJ-1", { paths: ["src/frozen/one.ts"] }),
      ticket("PROJ-2", { paths: ["src/frozen/two.ts"] }),
    ];
    const plan = planWaves(tickets, 5, { zones: [...zones, frozen] });
    expect(plan.waves).toEqual([["PROJ-1"], ["PROJ-2"]]);
  });

  it("ignores out-of-scope paths", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["dist", "src/a/x.ts"] }),
      ticket("PROJ-2", { paths: ["dist/app.js", "src/b/y.ts"] }),
    ];
    const plan = planWaves(tickets, 5, { zones });
    expect(plan.waves).toEqual([["PROJ-1", "PROJ-2"]]);
    expect(plan.hinges).toEqual([]);
  });

  it("orders the waves by ticket priority, undefined rank last", () => {
    const tickets = [
      ticket("PROJ-B", { paths: ["src/b.ts"], priorityRank: 5 }),
      ticket("PROJ-A", { paths: ["src/a.ts"] }),
      ticket("PROJ-C", { paths: ["src/c.ts"], priorityRank: 1 }),
    ];
    expect(planWaves(tickets, 5, { zones }).waves).toEqual([["PROJ-C", "PROJ-B", "PROJ-A"]]);
  });

  it("breaks priority ties on the nearest due date", () => {
    const tickets = [
      ticket("PROJ-LATE", { paths: ["src/l.ts"], priorityRank: 1, dueAt: "2026-12-01T00:00:00Z" }),
      ticket("PROJ-SOON", { paths: ["src/s.ts"], priorityRank: 1, dueAt: "2026-11-15T00:00:00Z" }),
    ];
    expect(planWaves(tickets, 5, { zones }).waves).toEqual([["PROJ-SOON", "PROJ-LATE"]]);
  });
});

describe("planWaves — edge cases", () => {
  it("handles an empty ticket list", () => {
    const plan = planWaves([], 3, { zones });
    expect(plan).toEqual({ waves: [], hinges: [], watchPairs: [], confidence: "high" });
  });

  it("handles more workers than tickets", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["src/a.ts"] }),
      ticket("PROJ-2", { paths: ["src/b.ts"] }),
      ticket("PROJ-3", { paths: ["src/c.ts"] }),
    ];
    const plan = planWaves(tickets, 10, { zones });
    expect(plan.waves).toEqual([["PROJ-1", "PROJ-2", "PROJ-3"]]);
  });

  it("never puts two linked tickets in one wave when only one worker is free", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["src/a.ts"] }),
      ticket("PROJ-2", { paths: ["src/a.ts", "src/b.ts"] }),
      ticket("PROJ-3", { paths: ["src/b.ts", "src/c.ts"] }),
      ticket("PROJ-4", { paths: ["src/c.ts"] }),
    ];
    const plan = planWaves(tickets, 1, { zones });
    for (const wave of plan.waves) expect(wave).toHaveLength(1);
    expectAllTicketsOnce(plan.waves, tickets);
  });

  it("degrades gracefully past maxWaves instead of losing tickets", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["db/migrations/0001_a.sql"], priorityRank: 1 }),
      ticket("PROJ-2", { paths: ["db/migrations/0001_a.sql", "db/migrations/0002_b.sql"], priorityRank: 2 }),
      ticket("PROJ-3", { paths: ["db/migrations/0002_b.sql", "db/migrations/0003_c.sql"], priorityRank: 3 }),
      ticket("PROJ-4", { paths: ["db/migrations/0003_c.sql"], priorityRank: 4 }),
    ];
    const plan = planWaves(tickets, 1, { zones, maxWaves: 2 });
    expect(plan.waves).toHaveLength(2);
    expectAllTicketsOnce(plan.waves, tickets);
  });

  it("spreads a fully linked clique one ticket per wave", () => {
    const tickets = ["PROJ-1", "PROJ-2", "PROJ-3", "PROJ-4"].map((key, index) =>
      ticket(key, { paths: [`db/migrations/000${index}_step.sql`], priorityRank: index + 1 }),
    );
    const plan = planWaves(tickets, 5, { zones });
    for (const wave of plan.waves) expect(wave).toHaveLength(1);
    expect(plan.waves.flat()).toEqual(["PROJ-1", "PROJ-2", "PROJ-3", "PROJ-4"]);
    expect(plan.waves[0]).toEqual([...plan.hinges]);
    expect(plan.hinges).toHaveLength(1);
  });

  it("reports a low confidence when most tickets have no footprint", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["src/a.ts"], components: [] }),
      ticket("PROJ-2", { paths: [], components: [] }),
      ticket("PROJ-3", { paths: [], components: ["billing"] }),
    ];
    const plan = planWaves(tickets, 3, { zones });
    expect(plan.confidence).toBe("low");
    expect(plan.confidenceNote).toContain("2 tickets without a component");
    expect(plan.confidenceNote).toContain("2 tickets without a footprint");
  });

  it("reports a high confidence when every ticket has a basis", () => {
    const tickets = [
      ticket("PROJ-1", { paths: ["src/a.ts"] }),
      ticket("PROJ-2", { paths: ["src/b.ts"] }),
      ticket("PROJ-3", { paths: ["src/c.ts"] }),
      ticket("PROJ-4", { paths: ["src/d.ts"] }),
      ticket("PROJ-5", { paths: ["src/e.ts"], components: [] }),
    ];
    const plan = planWaves(tickets, 3, { zones });
    expect(plan.confidence).toBe("high");
    expect(plan.confidenceNote).toBeUndefined();
  });
});
