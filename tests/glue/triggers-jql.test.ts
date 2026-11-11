/**
 * tests/glue/triggers-jql — Jira triggers (CC-16 §10) and JQL functions
 * (CC-18 §12), on the real services with memory stores. The glue is
 * dependency-injected (TriggerDeps), so no Forge runtime is needed.
 */

import { describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import type { Ctx } from "../../src/services/ctx";
import type { Identity, Stores } from "../../src/storage/interfaces";
import { declareFootprint } from "../../src/services/declare";
import { closeWorksite, openWorksite } from "../../src/services/worksites";
import { ensureWorksite } from "../../src/services/shared";
import { dailyJobs, sweep } from "../../src/services/maintenance";
import {
  EMPTY_JQL,
  clauseArgument,
  collidingIssueKeys,
  issueEvents,
  jqlCollidesWith,
  jqlCollidingWork,
  jqlForKeys,
  type TriggerDeps,
} from "../../src/glue/triggers";

const REPO = "acme/billing";

function makeBase() {
  const stores: Stores = createMemoryStores();
  const clock = makeClock("2026-11-11T09:00:00.000Z");
  const identity: Identity = { accountId: "lea@example.com", kind: "human", client: "trigger" };
  const ctx = { stores, now: () => clock.now(), identity, projectId: "PROJ" } as Ctx;
  const deps = {
    buildCtx: async () => ctx,
    ensureWorksite,
    openWorksite,
    closeWorksite,
    sweep,
    dailyJobs,
    predictionFor: async () => ({ prediction: undefined }),
    storePredictedFootprint: async () => 0,
  } as unknown as TriggerDeps;
  return { stores, clock, ctx, deps };
}

async function seedRepo(stores: Stores) {
  const repo = await stores.repos.ensure("PROJ", REPO);
  await stores.zones.seedDefaults(repo.id);
  return repo;
}

async function collide(base: ReturnType<typeof makeBase>) {
  await seedRepo(base.stores);
  const lea = { ...base.ctx, identity: { accountId: "lea@example.com", kind: "agent", client: "mcp", sessionRef: "s1" } as Identity } as Ctx;
  await declareFootprint(lea, { issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1" });
  const karim = { ...base.ctx, identity: { accountId: "karim@example.com", kind: "agent", client: "mcp", sessionRef: "s2" } as Identity } as Ctx;
  await declareFootprint(karim, { issueKey: "PROJ-101", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s2" });
}

describe("jqlForKeys / clauseArgument", () => {
  it("builds a valid predicate, dedupes and caps", () => {
    expect(jqlForKeys([])).toBe(EMPTY_JQL);
    expect(jqlForKeys(["PROJ-1", "PROJ-1", "PROJ-2"])).toBe("issuekey in (PROJ-1, PROJ-2)");
    const many = Array.from({ length: 250 }, (_, i) => `PROJ-${i}`);
    expect(jqlForKeys(many).split(",").length).toBe(200);
  });

  it("reads the clause argument from every tolerated payload shape", () => {
    expect(clauseArgument({ clause: { arguments: ["PROJ-88"] } })).toBe("PROJ-88");
    expect(clauseArgument({ clause: { arguments: [{ value: "PROJ-88" }] } })).toBe("PROJ-88");
    expect(clauseArgument({ issueKey: "PROJ-88" })).toBe("PROJ-88");
    expect(clauseArgument({ nope: true })).toBeUndefined();
  });
});

describe("jqlCollidingWork — issue in collidingWork()", () => {
  it("lists the tickets carrying an open collision", async () => {
    const base = makeBase();
    await collide(base);
    const keys = await collidingIssueKeys(base.ctx);
    expect(keys.sort()).toEqual(["PROJ-101", "PROJ-88"]);
    const result = await jqlCollidingWork(undefined, undefined, base.deps);
    expect(result.jql).toContain("PROJ-88");
    expect(result.jql).toContain("PROJ-101");
  });

  it("answers the empty predicate when nothing collides", async () => {
    const base = makeBase();
    await seedRepo(base.stores);
    const result = await jqlCollidingWork(undefined, undefined, base.deps);
    expect(result.jql).toBe(EMPTY_JQL);
  });
});

describe("jqlCollidesWith — issue in collidesWith(\"PROJ-88\")", () => {
  it("returns the neighbours, never the ticket itself", async () => {
    const base = makeBase();
    await collide(base);
    const result = await jqlCollidesWith({ clause: { arguments: ["PROJ-88"] } }, undefined, base.deps);
    expect(result.jql).toContain("PROJ-101");
    expect(result.jql).not.toContain("PROJ-88");
  });

  it("without argument, answers the empty predicate", async () => {
    const base = makeBase();
    const result = await jqlCollidesWith({}, undefined, base.deps);
    expect(result.jql).toBe(EMPTY_JQL);
  });
});

describe("issueEvents trigger — humans without an agent (§10)", () => {
  const created = (key: string) => ({
    events: [{ eventType: "avi:jira:created:issue", issue: { key, fields: { summary: "s", status: { name: "To Do" } } } }],
  });
  const inProgress = (key: string) => ({
    events: [{ eventType: "avi:jira:updated:issue", issue: { key, fields: { status: { name: "In Progress" } } } }],
  });
  const done = (key: string) => ({
    events: [{ eventType: "avi:jira:updated:issue", issue: { key, fields: { status: { statusCategory: { key: "done" }, name: "Done" } } } }],
  });

  it("a created ticket opens a PLANNED worksite", async () => {
    const base = makeBase();
    await seedRepo(base.stores);
    await issueEvents(created("PROJ-50"), undefined, base.deps);
    const repo = (await base.stores.repos.findBySlug("PROJ", REPO))!;
    const ws = await base.stores.worksites.findByIssue("PROJ-50", repo.id);
    expect(ws[0]?.state).toBe("planned");
  });

  it("moving to In Progress opens the worksite", async () => {
    const base = makeBase();
    await seedRepo(base.stores);
    await issueEvents(inProgress("PROJ-51"), undefined, base.deps);
    const repo = (await base.stores.repos.findBySlug("PROJ", REPO))!;
    const ws = await base.stores.worksites.findByIssue("PROJ-51", repo.id);
    expect(ws[0]?.state).toBe("open");
    expect(ws[0]?.kind).toBe("human");
  });

  it("closing the ticket closes the worksite", async () => {
    const base = makeBase();
    await seedRepo(base.stores);
    await issueEvents(inProgress("PROJ-52"), undefined, base.deps);
    await issueEvents(done("PROJ-52"), undefined, base.deps);
    const repo = (await base.stores.repos.findBySlug("PROJ", REPO))!;
    expect(await base.stores.worksites.findByIssue("PROJ-52", repo.id)).toHaveLength(0);
    const all = await base.stores.worksites.listMerged(repo.id);
    expect(all).toHaveLength(0); // outcome "done", not "merged"
  });

  it("without a registered repository, events are ignored safely", async () => {
    const base = makeBase();
    await expect(issueEvents(created("PROJ-53"), undefined, base.deps)).resolves.toBeUndefined();
  });
});
