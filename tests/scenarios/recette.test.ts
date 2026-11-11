/**
 * tests/scenarios/recette — acceptance scenarios of spec §22.
 * Items 1, 2, 3, 5, 6, 8, 10, 11, 12 are covered in tests/services/
 * (services.test.ts) and tests/glue/; this file covers the remaining
 * ground: dormancy (7), parallel waves (9), the simulation console (13)
 * and the no-file-content guarantee (14), plus the reservation-driven
 * collision that powers the four-agents story.
 */

import { describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock, type TestClock } from "../../src/testing/clock";
import type { Ctx } from "../../src/services/ctx";
import type { Identity, TicketMeta } from "../../src/core/types";
import { declareFootprint } from "../../src/services/declare";
import { sweep } from "../../src/services/maintenance";
import { planParallelWork } from "../../src/services/planning";
import { hookTouch } from "../../src/services/ingest";
import { runScenario } from "../../src/simulation/run";
import { FOUR_AGENTS } from "../fixtures/four-agents";
import type { JiraPort } from "../../src/services/ctx";

const REPO = "acme/billing";

function makeCtx(actor: Partial<Identity> = {}, jira?: Partial<JiraPort>) {
  const stores = createMemoryStores();
  const clock: TestClock = makeClock("2026-11-11T09:00:00.000Z");
  const identity: Identity = {
    accountId: "lea@example.com",
    kind: "agent",
    client: "claude-code",
    ...actor,
  };
  const ctx = {
    stores,
    now: () => clock.now(),
    identity,
    projectId: "PROJ",
    jira: jira as JiraPort | undefined,
  } as Ctx;
  return { stores, clock, ctx };
}

describe("recette §22.7 — dormancy and auto-close", () => {
  it("sleeps after 24 h idle, closes after 7 dormant days", async () => {
    const { ctx, clock, stores } = makeCtx({ sessionRef: "s1" });
    await declareFootprint(ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1",
    });

    clock.advance(25 * 60); // 25 hours
    const first = await sweep(ctx);
    expect(first.dormant).toHaveLength(1);
    const repo = (await stores.repos.findBySlug("PROJ", REPO))!;
    const open = await stores.worksites.listOpenByRepo(repo.id);
    expect(open[0]?.state).toBe("dormant");

    clock.advance(8 * 24 * 60); // 8 more days
    const second = await sweep(ctx);
    expect(second.closed).toHaveLength(1);
    expect(await stores.worksites.listOpenByRepo(repo.id)).toHaveLength(0);
  });
});

describe("recette §22.9 — plan-parallel-work", () => {
  const SIX: { key: string; rank: number; paths: string[] }[] = [
    { key: "PROJ-88", rank: 1, paths: ["db/migrations/0042_total_cents.sql", "src/billing/invoice.ts"] },
    { key: "PROJ-93", rank: 2, paths: ["src/i18n/messages.json"] },
    { key: "PROJ-95", rank: 3, paths: ["src/i18n/messages.json"] },
    { key: "PROJ-97", rank: 4, paths: ["src/billing/service.ts"] },
    { key: "PROJ-101", rank: 5, paths: ["db/migrations/0043_index.sql"] },
    { key: "PROJ-90", rank: 6, paths: ["src/billing/service.ts", "src/billing/invoice.ts", "db/migrations/0041_rename.sql"] },
  ];

  async function seeded() {
    const tickets: TicketMeta[] = SIX.map((t) => ({
      issueKey: t.key,
      components: ["billing"],
      priorityRank: t.rank,
    }));
    const jira: Partial<JiraPort> = {
      searchIssues: async () => tickets,
      getIssue: async (key: string) => tickets.find((t) => t.issueKey === key),
    };
    const base = makeCtx({ accountId: "planner@example.com", kind: "human" }, jira);
    const repo = await base.stores.repos.ensure("PROJ", REPO);
    await base.stores.zones.seedDefaults(repo.id);
    for (const t of SIX) {
      await base.stores.predictions.save({
        issueKey: t.key,
        repoId: repo.id,
        entries: t.paths.map((p) => ({
          path: p,
          kind: p.split("/").pop()!.includes(".") ? ("file" as const) : ("dir" as const),
          confidence: 0.8,
        })),
        confidence: 0.8,
        basis: { componentMatch: true, referenceTickets: [] },
        computedAt: base.clock.now(),
      });
    }
    return base;
  }

  it("no wave holds two colliding tickets; hinges go first alone", async () => {
    const { ctx } = await seeded();
    const plan = await planParallelWork(ctx, { jql: "sprint = 42", workers: 3 });

    // PROJ-90 renames the billing service: linked to 88 (invoice.ts),
    // 97 (service.ts) and 101 (migrations) → the hinge, alone and first.
    expect(plan.hinges).toContain("PROJ-90");
    expect(plan.waves[0]).toEqual(["PROJ-90"]);

    // 88 and 101 share the exclusive migrations resource: never together.
    const waveOf = new Map<string, number>();
    plan.waves.forEach((wave, i) => wave.forEach((k) => waveOf.set(k, i)));
    expect(waveOf.get("PROJ-88")).not.toBe(waveOf.get("PROJ-101"));

    // 93 × 95 share a hotspot translations file: watch pair, not a wall.
    const watch = plan.watchPairs.find(
      (p) => [p.a, p.b].sort().join("|") === ["PROJ-93", "PROJ-95"].sort().join("|"),
    );
    expect(watch).toBeDefined();

    // every wave respects the worker count (except the hinge wave)
    for (const wave of plan.waves.slice(1)) expect(wave.length).toBeLessThanOrEqual(3);
    // all six tickets are scheduled exactly once
    expect(plan.waves.flat().sort()).toEqual(SIX.map((t) => t.key).sort());
  });

  it("linked tickets never share a wave (invariant check)", async () => {
    const { ctx } = await seeded();
    const plan: Awaited<ReturnType<typeof planParallelWork>> = await planParallelWork(ctx, {
      jql: "sprint = 42",
      workers: 3,
    });
    const links: [string, string][] = [
      ["PROJ-88", "PROJ-101"], // exclusive migrations
      ["PROJ-88", "PROJ-90"], // same file invoice.ts
      ["PROJ-97", "PROJ-90"], // same file service.ts
    ];
    for (const wave of plan.waves) {
      for (const [a, b] of links) {
        const both = wave.includes(a) && wave.includes(b);
        if (both) {
          // allowed only for the hinge wave if one of them is the hinge
          expect(plan.hinges.includes(a) || plan.hinges.includes(b)).toBe(true);
          expect(wave).toHaveLength(1);
        }
      }
    }
  });
});

describe("recette §22.13 — the simulation console replays the story", () => {
  it("four agents scenario passes end to end, without any repository", async () => {
    const result = await runScenario(FOUR_AGENTS);
    expect(result.scenarioKey).toBe("four-agents");
    expect(result.results).toHaveLength(FOUR_AGENTS.steps.length);
    const failed = result.results.filter((r) => !r.ok);
    expect(failed.map((r) => `${r.index}:${r.step.action}:${r.detail}`)).toEqual([]);
    expect(result.allOk).toBe(true);
  });
});

describe("recette §22.14 — no table ever holds file content", () => {
  it("a full hook session stores paths, never content", async () => {
    const { ctx, stores } = makeCtx({ sessionRef: "s1" });
    await declareFootprint(ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1",
    });
    const SECRET = "const total = invoices.reduce((s, i) => s + i.cents, 0);";
    // A caller smuggling content through unknown fields changes nothing:
    // the service reads path/session/cwd only.
    const sneaky = {
      sessionRef: "s1",
      path: "/work/src/billing/invoice.ts",
      cwd: "/work",
      repoSlug: REPO,
      tool_input: { old_string: SECRET, new_string: SECRET },
    } as never;
    await hookTouch(ctx, sneaky);

    const repo = (await stores.repos.findBySlug("PROJ", REPO))!;
    const dump: unknown[] = [];
    for (const w of await stores.worksites.listOpenByRepo(repo.id)) {
      dump.push(w);
      dump.push(await stores.footprints.listByWorksite(w.id));
      dump.push(await stores.events.listByWorksite(w.id, 100));
      dump.push(await stores.notices.listByWorksite(w.id));
    }
    dump.push(await stores.events.recent(200));
    const serialized = JSON.stringify(dump);
    expect(serialized).not.toContain("reduce");
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain("src/billing/invoice.ts"); // paths ARE stored
  });
});

describe("reservation-driven collision (spec §8)", () => {
  it("a reservation alone blocks a declaration, and closing frees it", async () => {
    const { ctx } = makeCtx({ sessionRef: "s1" });
    // PROJ-93 reserves WITHOUT declaring any footprint
    const { reserveZone } = await import("../../src/services/reservations");
    const res = await reserveZone(ctx, {
      issueKey: "PROJ-93", repoSlug: REPO, paths: "db/migrations", minutes: 120,
    });
    expect("refused" in res && res.refused).toBeFalsy();

    const karim = {
      ...ctx,
      identity: { accountId: "karim@example.com", kind: "agent", client: "claude-code", sessionRef: "s2" } as Identity,
    } as Ctx;
    const blocked = await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "db/migrations/0043.sql", session: "s2",
    });
    expect(blocked.kind).toBe("wait");
    expect(blocked.collisions[0]?.degree).toBe(4);

    const { closeWorksite } = await import("../../src/services/worksites");
    await closeWorksite(ctx, { issueKey: "PROJ-93" });
    const freed = await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "db/migrations/0043.sql", session: "s2",
    });
    expect(freed.kind).toBe("free");
  });
});
