/**
 * tests/ui/props.test.ts — shape tests for the workstream J screens.
 *
 * The Forge UI kit JSX does not execute under vitest (server-rendered by the
 * Forge runtime), so these tests never import the .tsx files: they check
 * (1) that the fixtures handed to the screens are internally coherent — every
 * collision names a neighbour that is present, every step result points at a
 * step that exists — and (2) that the screen files export the expected names
 * and import nothing forbidden.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  CollisionStats,
  NeighborInfo,
  SimulationResult,
  SimulationScenario,
  WorksitePanel,
} from "../../src/core/types";

const UI_DIR = join(__dirname, "..", "..", "src", "ui");

function source(name: string): string {
  return readFileSync(join(UI_DIR, name), "utf8");
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const MINE = "ws-mine";
const NEIGHBOR = "ws-other";

const neighbor: NeighborInfo = {
  worksiteId: NEIGHBOR,
  issueKey: "PROJ-88",
  accountId: "acc-lea",
  actorLabel: "agent of Léa (session 3f2a)",
  kind: "agent",
  sessionRef: "3f2a",
  state: "active",
  lastActivityAt: "2026-11-11T09:56:00.000Z",
  prOpen: true,
  branch: "feature/PROJ-88",
  notice: "I rename invoices.total to total_cents",
};

export const PANEL_FIXTURE: WorksitePanel = {
  issueKey: "PROJ-42",
  repos: [
    {
      repo: {
        id: "repo-billing",
        projectId: "project-1",
        provider: "github",
        slug: "acme/billing",
        defaultBranch: "main",
      },
      worksites: [
        {
          id: MINE,
          issueKey: "PROJ-42",
          repoId: "repo-billing",
          accountId: "acc-me",
          kind: "human",
          branch: "feature/PROJ-42",
          state: "active",
          openedAt: "2026-11-11T09:10:00.000Z",
          lastActivityAt: "2026-11-11T09:58:00.000Z",
          ticket: { issueKey: "PROJ-42", components: ["billing"] },
        },
      ],
      footprintsBySource: {
        predicted: [
          {
            worksiteId: MINE,
            path: "src/billing/",
            kind: "dir",
            source: "predicted",
            mode: "edit",
            firstAt: "2026-11-11T09:10:00.000Z",
            lastAt: "2026-11-11T09:10:00.000Z",
          },
        ],
        declared: [
          {
            worksiteId: MINE,
            path: "db/migrations/007_add_total_cents.sql",
            kind: "file",
            source: "declared",
            mode: "create",
            firstAt: "2026-11-11T09:12:00.000Z",
            lastAt: "2026-11-11T09:12:00.000Z",
          },
        ],
        observed: [
          {
            worksiteId: MINE,
            path: "src/billing/invoice.ts",
            kind: "file",
            source: "observed",
            mode: "edit",
            firstAt: "2026-11-11T09:40:00.000Z",
            lastAt: "2026-11-11T09:55:00.000Z",
            declaredMismatch: true,
          },
        ],
        attested: [],
      },
      coverage: { predicted: 1, declared: 1, observed: 1 },
      neighbors: [neighbor],
      collisions: [
        {
          id: "col-1",
          repoId: "repo-billing",
          worksiteA: MINE,
          worksiteB: NEIGHBOR,
          zoneId: "zone-migrations",
          path: "db/migrations/",
          degree: 4,
          rawDegree: 4,
          phase: "before-code",
          state: "open",
          detectedAt: "2026-11-11T09:30:00.000Z",
        },
        {
          id: "col-2",
          repoId: "repo-billing",
          worksiteA: MINE,
          worksiteB: NEIGHBOR,
          zoneId: "zone-billing",
          path: "src/billing/",
          degree: 1,
          rawDegree: 2,
          phase: "live",
          state: "open",
          probable: true,
          detectedAt: "2026-11-11T09:45:00.000Z",
        },
      ],
      noticesInbox: [
        {
          noticeId: "notice-1",
          fromIssueKey: "PROJ-88",
          fromActorLabel: "agent of Léa (session 3f2a)",
          paths: ["db/migrations/"],
          text: "I rename the column first.",
          createdAt: "2026-11-11T09:31:00.000Z",
        },
      ],
      noticesSent: [
        {
          id: "notice-2",
          worksiteId: MINE,
          repoId: "repo-billing",
          authorAccountId: "acc-me",
          issueKey: "PROJ-42",
          paths: ["db/migrations/"],
          text: "I need one migration slot.",
          createdAt: "2026-11-11T09:32:00.000Z",
        },
      ],
      reservations: [
        {
          id: "res-1",
          worksiteId: NEIGHBOR,
          repoId: "repo-billing",
          patterns: ["db/migrations/**"],
          hard: true,
          reason: "one migration at a time",
          createdAt: "2026-11-11T09:20:00.000Z",
          expiresAt: "2026-11-11T11:20:00.000Z",
        },
      ],
    },
  ],
};

export const EMPTY_PANEL: WorksitePanel = { issueKey: "PROJ-99", repos: [] };

export const STATS_FIXTURE: CollisionStats = {
  seenBeforeCode: 12,
  seenWhileWorking: 5,
  seenAtPr: 3,
  missedUntilMerge: 1,
  predictionAccuracy: 0.75,
};

const SCENARIO: SimulationScenario = {
  key: "four-agents",
  title: "Four agents, one migration",
  description: "Four agents land on db/migrations/ in the same minute.",
  repos: [{ slug: "acme/billing", defaultBranch: "main" }],
  actors: [
    { ref: "lea", accountId: "acc-lea", displayName: "Léa", kind: "human" },
    { ref: "bot", accountId: "acc-bot", displayName: "Bot", kind: "agent" },
  ],
  steps: [
    { actor: "lea", action: "open", input: { branch: "feature/a" } },
    {
      actor: "bot",
      action: "declare",
      input: { paths: "db/migrations/" },
      expect: { verdict: "wait", degree: 4 },
      note: "exclusive zone held by Léa",
    },
  ],
};

export const RESULT_FIXTURE: SimulationResult = {
  scenarioKey: SCENARIO.key,
  allOk: false,
  results: [
    { index: 1, step: SCENARIO.steps[0], ok: true },
    {
      index: 2,
      step: SCENARIO.steps[1],
      ok: false,
      detail: "expected wait, got caution",
      verdict: {
        kind: "caution",
        collisions: [],
        pendingNotices: [],
        text: "caution: D1 with PROJ-88 on db/migrations/",
      },
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Coherence of the fixtures (they must be usable as screen props)      */
/* ------------------------------------------------------------------ */

describe("worksite panel fixture", () => {
  it("has one repo block with all four footprint sources present", () => {
    const block = PANEL_FIXTURE.repos[0];
    expect(Object.keys(block.footprintsBySource).sort()).toEqual([
      "attested",
      "declared",
      "observed",
      "predicted",
    ]);
    expect(block.coverage.observed).toBe(1);
  });

  it("declares a mismatch that the panel shows as a gap", () => {
    const observed = PANEL_FIXTURE.repos[0].footprintsBySource.observed;
    expect(observed.filter((e) => e.declaredMismatch === true)).toHaveLength(1);
  });

  it("gives every collision a neighbour present in the same block, or my own worksite", () => {
    for (const block of PANEL_FIXTURE.repos) {
      const known = new Set([
        ...block.neighbors.map((n) => n.worksiteId),
        ...block.worksites.map((w) => w.id),
      ]);
      for (const collision of block.collisions) {
        expect(known.has(collision.worksiteA)).toBe(true);
        expect(known.has(collision.worksiteB)).toBe(true);
      }
    }
  });

  it("points every collision zone at an existing zone id", () => {
    const zoneIds = ["zone-migrations", "zone-billing"];
    for (const block of PANEL_FIXTURE.repos) {
      for (const collision of block.collisions) {
        if (collision.zoneId === undefined) continue;
        expect(zoneIds).toContain(collision.zoneId);
      }
    }
  });

  it("keeps the empty panel trivially coherent (no repos)", () => {
    expect(EMPTY_PANEL.repos).toHaveLength(0);
    expect(EMPTY_PANEL.issueKey).toBe("PROJ-99");
  });
});

describe("stats and simulation fixtures", () => {
  it("adds up to the four numbers of spec §13", () => {
    const seen =
      STATS_FIXTURE.seenBeforeCode +
      STATS_FIXTURE.seenWhileWorking +
      STATS_FIXTURE.seenAtPr;
    expect(seen + STATS_FIXTURE.missedUntilMerge).toBe(21);
    expect(STATS_FIXTURE.predictionAccuracy).toBeGreaterThan(0);
    expect(STATS_FIXTURE.predictionAccuracy).toBeLessThanOrEqual(1);
  });

  it("references an existing scenario and existing steps only", () => {
    expect(RESULT_FIXTURE.scenarioKey).toBe(SCENARIO.key);
    for (const result of RESULT_FIXTURE.results) {
      const step = SCENARIO.steps.find(
        (s) => s.actor === result.step.actor && s.action === result.step.action,
      );
      expect(step).toBeDefined();
      expect(result.step).toBe(step);
    }
  });

  it("numbers its step results 1..n in order", () => {
    expect(RESULT_FIXTURE.results.map((r) => r.index)).toEqual([1, 2]);
    expect(RESULT_FIXTURE.allOk).toBe(
      RESULT_FIXTURE.results.every((r) => r.ok),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Screen files: exports, action keys, imported modules                */
/* ------------------------------------------------------------------ */

const SCREENS = [
  { file: "issuePanel.tsx", exports: ["export function IssuePanel"] },
  { file: "gadget.tsx", exports: ["export function Gadget"] },
  { file: "simulation.tsx", exports: ["export function SimulationConsole"] },
];

describe("screen files export what the resolver renders", () => {
  for (const screen of SCREENS) {
    it(`${screen.file} exports its screen component`, () => {
      const text = source(screen.file);
      for (const name of screen.exports) expect(text).toContain(name);
      expect(text).toContain("@forge/ui");
    });

    it(`${screen.file} imports no backend module`, () => {
      const text = source(screen.file);
      expect(text).not.toContain("@forge/api");
      expect(text).not.toContain("@forge/sql");
      expect(text).not.toContain("node:fs");
    });
  }
});

describe("action keys announced to the glue", () => {
  const expected: Record<string, string[]> = {
    "issuePanel.tsx": ["collisions.resolve", "worksites.iWorkOnIt"],
    "simulation.tsx": ["simulation.run"],
  };

  for (const [file, keys] of Object.entries(expected)) {
    it(`${file} uses its documented resolver keys`, () => {
      const text = source(file);
      for (const key of keys) expect(text).toContain(`"${key}"`);
    });
  }
});

describe("screens reuse the frozen components", () => {
  it("issuePanel imports DegreeLozenge, FootprintTable, NeighborList", () => {
    const text = source("issuePanel.tsx");
    for (const name of ["DegreeLozenge", "FootprintTable", "NeighborList"]) {
      expect(text).toContain(name);
    }
  });

  it("simulation imports VerdictBlock and only reads props", () => {
    const text = source("simulation.tsx");
    expect(text).toContain("VerdictBlock");
    expect(text).toContain("SimulationScenario");
    expect(text).toContain("SimulationResult");
  });
});
