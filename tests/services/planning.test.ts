import { describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import type { Ctx, JiraPort } from "../../src/services/ctx";
import type { Identity, TicketMeta } from "../../src/core/types";
import { declareFootprint } from "../../src/services/declare";
import { reportConflict } from "../../src/services/ingest";
import { collisionStats, listClearWork, nextClearTicket } from "../../src/services/planning";

const REPO = "acme/billing";

const TICKETS: TicketMeta[] = [
  { issueKey: "PROJ-10", components: [], priorityRank: 3 },
  { issueKey: "PROJ-11", components: [], priorityRank: 1 },
  { issueKey: "PROJ-12", components: [], priorityRank: 2 },
];

function makeCtx(actor: Partial<Identity> = {}, tickets: TicketMeta[] = TICKETS) {
  const stores = createMemoryStores();
  const clock = makeClock("2026-11-11T09:00:00.000Z");
  const jira = {
    searchIssues: async () => tickets,
    getIssue: async (key: string) => tickets.find((t) => t.issueKey === key),
  } as JiraPort;
  const ctx = {
    stores,
    now: () => clock.now(),
    identity: {
      accountId: "planner@example.com",
      kind: "human",
      client: "mcp",
      ...actor,
    },
    projectId: "PROJ",
    jira,
  } as Ctx;
  return { stores, clock, ctx };
}

async function agentDeclares(
  base: ReturnType<typeof makeCtx>,
  issueKey: string,
  paths: string,
  session: string,
) {
  const ctx = {
    ...base.ctx,
    identity: {
      accountId: "lea@example.com",
      kind: "agent",
      client: "claude-code",
      sessionRef: session,
    } as Identity,
  } as Ctx;
  return declareFootprint(ctx, { issueKey, repoSlug: REPO, paths, session });
}

describe("listClearWork", () => {
  it("removes tickets already taken by an open worksite", async () => {
    const base = makeCtx();
    await agentDeclares(base, "PROJ-11", "src/billing/invoice.ts", "s1");
    const clear = await listClearWork(base.ctx, { jql: "sprint = 1" });
    const keys = clear.map((t) => t.issueKey).sort();
    // PROJ-11 is busy; PROJ-12 has no known footprint → nothing to collide with
    expect(keys).toEqual(["PROJ-10", "PROJ-12"]);
    expect(keys).not.toContain("PROJ-11");
  });

  it("a ticket with an open worksite is busy, not clear", async () => {
    const base = makeCtx();
    await agentDeclares(base, "PROJ-11", "src/billing/invoice.ts", "s1");
    const clear = await listClearWork(base.ctx, { jql: "sprint = 1" });
    expect(clear.map((t) => t.issueKey)).not.toContain("PROJ-11");
  });

  it("a colliding candidate is excluded", async () => {
    const base = makeCtx();
    await agentDeclares(base, "PROJ-11", "src/billing/invoice.ts", "s1");
    // PROJ-12 has a stored footprint overlapping PROJ-11's worksite
    const repo = await base.stores.repos.ensure("PROJ", REPO);
    await base.stores.predictions.save({
      issueKey: "PROJ-12",
      repoId: repo.id,
      entries: [{ path: "src/billing/invoice.ts", kind: "file", confidence: 0.9 }],
      confidence: 0.9,
      basis: { componentMatch: false, referenceTickets: [] },
      computedAt: base.clock.now(),
    });
    const clear = await listClearWork(base.ctx, { jql: "sprint = 1" });
    expect(clear.map((t) => t.issueKey)).not.toContain("PROJ-12");
    expect(clear.map((t) => t.issueKey)).toContain("PROJ-10");
  });
});

describe("nextClearTicket — the dispatcher (spec §27)", () => {
  it("returns the highest-priority clear ticket with alternatives", async () => {
    const base = makeCtx();
    const next = await nextClearTicket(base.ctx, { jql: "sprint = 1" });
    expect(next.issueKey).toBe("PROJ-11"); // rank 1
    expect(next.alternatives).toEqual(["PROJ-12", "PROJ-10"]); // rank 2, 3
    expect(next.why).toContain("no collision");
  });

  it("skips tickets that collide with open worksites", async () => {
    const base = makeCtx();
    await agentDeclares(base, "PROJ-11", "src/billing/invoice.ts", "s1");
    const repo = await base.stores.repos.ensure("PROJ", REPO);
    await base.stores.predictions.save({
      issueKey: "PROJ-12",
      repoId: repo.id,
      entries: [{ path: "src/billing/", kind: "dir", confidence: 0.9 }],
      confidence: 0.9,
      basis: { componentMatch: false, referenceTickets: [] },
      computedAt: base.clock.now(),
    });
    const next = await nextClearTicket(base.ctx, { jql: "sprint = 1" });
    expect(next.issueKey).toBe("PROJ-10");
    expect(next.alternatives).toEqual([]);
  });

  it("answers honestly when nothing is clear", async () => {
    const base = makeCtx({}, []);
    const next = await nextClearTicket(base.ctx, { jql: "sprint = 1" });
    expect(next.issueKey).toBeUndefined();
    expect(next.why).toContain("no clear ticket");
  });

  it("nearest due date breaks a priority tie", async () => {
    const base = makeCtx({}, [
      { issueKey: "PROJ-20", components: [], priorityRank: 1, dueAt: "2026-12-01T00:00:00.000Z" },
      { issueKey: "PROJ-21", components: [], priorityRank: 1, dueAt: "2026-11-20T00:00:00.000Z" },
    ]);
    const next = await nextClearTicket(base.ctx, { jql: "sprint = 1" });
    expect(next.issueKey).toBe("PROJ-21");
  });
});

describe("collisionStats — the four numbers (§13)", () => {
  it("counts live collisions and missed conflicts", async () => {
    const base = makeCtx();
    await agentDeclares(base, "PROJ-11", "src/billing/invoice.ts", "s1");
    const karim = {
      ...base.ctx,
      identity: {
        accountId: "karim@example.com",
        kind: "agent",
        client: "claude-code",
        sessionRef: "s2",
      } as Identity,
    } as Ctx;
    await declareFootprint(karim, {
      issueKey: "PROJ-12",
      repoSlug: REPO,
      paths: "src/billing/invoice.ts",
      session: "s2",
    });
    // a conflict the app never saw (different paths than any collision)
    await reportConflict(base.ctx, {
      issueKey: "PROJ-11",
      repoSlug: REPO,
      paths: "docs/never-declared.md",
    });

    const stats = await collisionStats(base.ctx, {});
    expect(stats.seenWhileWorking).toBeGreaterThanOrEqual(1);
    expect(stats.missedUntilMerge).toBe(1);
    expect(stats.seenBeforeCode).toBe(0);
    expect(stats.seenAtPr).toBe(0);
  });
});
