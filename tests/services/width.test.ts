import { describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import type { Ctx, JiraPort } from "../../src/services/ctx";
import type { Identity, TicketMeta } from "../../src/core/types";
import { measureParallelWidth } from "../../src/services/width";
import { declareFootprint } from "../../src/services/declare";

const REPO = "acme/billing";

function ticket(key: string, rank?: number): TicketMeta {
  return { issueKey: key, components: ["billing"], priorityRank: rank };
}

function makeCtx(tickets: TicketMeta[], histories: Record<string, string[]> = {}) {
  const stores = createMemoryStores();
  const clock = makeClock("2026-11-11T09:00:00.000Z");
  const jira = {
    searchIssues: async () => tickets,
    getIssue: async (key: string) => tickets.find((t) => t.issueKey === key),
    mergedHistory: async () =>
      Object.entries(histories).map(([issueKey, paths]) => ({
        issueKey,
        components: ["billing"],
        paths,
      })),
  } as JiraPort;
  const ctx = {
    stores,
    now: () => clock.now(),
    identity: { accountId: "planner@example.com", kind: "human", client: "mcp" } as Identity,
    projectId: "PROJ",
    jira,
  } as Ctx;
  return { stores, clock, ctx };
}

/** Seed predictions so planTicketFor finds footprints without history. */
async function seed(base: ReturnType<typeof makeCtx>, footprints: Record<string, string[]>) {
  const repo = await base.stores.repos.ensure("PROJ", REPO);
  await base.stores.zones.seedDefaults(repo.id);
  for (const [issueKey, paths] of Object.entries(footprints)) {
    await base.stores.predictions.save({
      issueKey,
      repoId: repo.id,
      entries: paths.map((path) => ({
        path,
        kind: path.split("/").pop()!.includes(".") ? ("file" as const) : ("dir" as const),
        confidence: 0.9,
      })),
      confidence: 0.9,
      basis: { componentMatch: true, referenceTickets: [] },
      computedAt: base.clock.now(),
    });
  }
  return repo;
}

describe("measureParallelWidth", () => {
  it("independent tickets run all at once", async () => {
    const base = makeCtx([ticket("PROJ-1"), ticket("PROJ-2"), ticket("PROJ-3")]);
    await seed(base, {
      "PROJ-1": ["src/a/x.ts"],
      "PROJ-2": ["src/b/y.ts"],
      "PROJ-3": ["src/c/z.ts"],
    });
    const report = await measureParallelWidth(base.ctx, { jql: "sprint = 1", repoSlug: REPO });
    expect(report.width).toBe(3);
    expect(report.ticketCount).toBe(3);
    expect(report.bottlenecks).toHaveLength(0);
    expect(report.confidence).toBe("high");
  });

  it("an exclusive zone serializes everything and is the bottleneck", async () => {
    const base = makeCtx([ticket("PROJ-1"), ticket("PROJ-2"), ticket("PROJ-3")]);
    await seed(base, {
      "PROJ-1": ["db/migrations/0001.sql"],
      "PROJ-2": ["db/migrations/0002.sql"],
      "PROJ-3": ["db/migrations/0003.sql"],
    });
    const report = await measureParallelWidth(base.ctx, { jql: "sprint = 1", repoSlug: REPO });
    expect(report.width).toBe(1);
    expect(report.bottlenecks[0]?.zoneName).toBe("migrations");
    expect(report.suggestion).toBeDefined();
    expect(report.suggestion!.widthAfter).toBe(3);
    expect(report.suggestion!.delta).toBe(2);
    expect(report.suggestion!.split).toContain("migrations");
  });

  it("a shared file bottlenecks on the path, splitting it raises the width", async () => {
    const base = makeCtx([ticket("PROJ-1"), ticket("PROJ-2"), ticket("PROJ-3")]);
    await seed(base, {
      "PROJ-1": ["src/app/routes-table.ts", "src/a/x.ts"],
      "PROJ-2": ["src/app/routes-table.ts", "src/b/y.ts"],
      "PROJ-3": ["src/app/routes-table.ts", "src/c/z.ts"],
    });
    const report = await measureParallelWidth(base.ctx, { jql: "sprint = 1", repoSlug: REPO });
    expect(report.width).toBe(1);
    expect(report.bottlenecks[0]?.path).toBe("src/app/routes-table.ts");
    expect(report.suggestion!.widthAfter).toBe(3);
  });

  it("a hotspot does not wall: two tickets on the same translations file stay parallel", async () => {
    const base = makeCtx([ticket("PROJ-1"), ticket("PROJ-2")]);
    await seed(base, {
      "PROJ-1": ["src/i18n/messages.json"],
      "PROJ-2": ["src/i18n/messages.json"],
    });
    const report = await measureParallelWidth(base.ctx, { jql: "sprint = 1", repoSlug: REPO });
    // hotspot lowers D2 → D1: not a wall, both fit in one wave
    expect(report.width).toBe(2);
  });

  it("falls back to merged history, then to open worksites", async () => {
    const base = makeCtx(
      [],
      { "PROJ-90": ["src/a/x.ts"], "PROJ-91": ["src/b/y.ts"] },
    );
    await base.stores.repos.ensure("PROJ", REPO);
    const report = await measureParallelWidth(base.ctx, { repoSlug: REPO });
    expect(report.ticketCount).toBe(2);
    expect(report.width).toBe(2);
  });

  it("open worksites feed the measure when there is no history", async () => {
    const stores = createMemoryStores();
    const clock = makeClock("2026-11-11T09:00:00.000Z");
    const ctx = {
      stores,
      now: () => clock.now(),
      identity: { accountId: "lea@example.com", kind: "agent", client: "mcp", sessionRef: "s1" } as Identity,
      projectId: "PROJ",
    } as Ctx;
    await declareFootprint(ctx, { issueKey: "PROJ-88", repoSlug: REPO, paths: "src/a/x.ts", session: "s1" });
    const ctx2 = {
      ...ctx,
      identity: { accountId: "karim@example.com", kind: "agent", client: "mcp", sessionRef: "s2" } as Identity,
    } as Ctx;
    await declareFootprint(ctx2, { issueKey: "PROJ-101", repoSlug: REPO, paths: "src/b/y.ts", session: "s2" });
    const report = await measureParallelWidth(ctx, { repoSlug: REPO });
    expect(report.ticketCount).toBe(2);
    expect(report.width).toBe(2);
  });

  it("confidence drops when tickets have no footprint", async () => {
    const base = makeCtx([ticket("PROJ-1"), ticket("PROJ-2"), ticket("PROJ-3")]);
    await seed(base, { "PROJ-1": ["src/a/x.ts"] });
    const report = await measureParallelWidth(base.ctx, { jql: "sprint = 1", repoSlug: REPO });
    expect(report.confidence).toBe("low");
    expect(report.note).toContain("no footprint");
  });
});
