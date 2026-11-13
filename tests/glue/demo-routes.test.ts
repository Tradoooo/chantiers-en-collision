/**
 * tests/glue/demo-routes — the PUBLIC demo routes: the real state of the
 * demo repository and a real verdict for a path, computed against the live
 * worksites. Only the allow-listed demo repo may be read.
 */

import { describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import type { Ctx } from "../../src/services/ctx";
import type { Degree, Worksite } from "../../src/core/types";
import { routeWebtrigger, type WebtriggerDeps, type WebtriggerRequest } from "../../src/glue/webtrigger";

async function world() {
  const stores = createMemoryStores();
  const clock = makeClock("2026-11-12T09:00:00.000Z");
  const repo = await stores.repos.ensure("PROJ", "acme/billing");
  await stores.zones.seedDefaults(repo.id);
  const w = await stores.worksites.create({
    issueKey: "PROJ-1",
    repoId: repo.id,
    accountId: "lea@example.com",
    kind: "agent",
    state: "active",
    branch: "feature/PROJ-1-total",
    openedAt: clock.now(),
    lastActivityAt: clock.now(),
  });
  await stores.footprints.add([
    {
      worksiteId: w.id,
      path: "src/billing/invoice.ts",
      kind: "file",
      source: "declared",
      mode: "edit",
      at: clock.now(),
    },
  ]);
  const ctx = {
    stores,
    now: () => clock.now(),
    identity: { accountId: "demo@example.com", kind: "human", client: "demo" },
    projectId: "PROJ",
  } as Ctx;
  return { ctx, repo };
}

function deps(ctx: Ctx): WebtriggerDeps {
  return {
    buildCtx: async () => ctx,
    verifyToken: async () => undefined,
    hookOpen: async () => ({ response: {} }),
    hookTouch: async () => ({}),
    hookClose: async () => undefined,
    ciFootprint: async () => ({ entries: 0 }),
    reportConflict: async () => ({}) as never,
    status: async () => ({}) as never,
    createToken: async () => ({ token: "t", tokenHash: "h", scope: "personal" }),
    ensureRepo: async () => ({}),
    tools: {},
  } as unknown as WebtriggerDeps;
}

function post(path: string, body: unknown): WebtriggerRequest {
  return {
    method: "POST",
    path: `/public/abc123${path}`,
    headers: { "content-type": ["application/json"] },
    body: JSON.stringify(body),
  };
}

describe("/demo/state and /demo/verdict", () => {
  it("serves the live state of the demo repository", async () => {
    const { ctx } = await world();
    const res = await routeWebtrigger(post("/demo/state", { repo: "acme/billing" }), deps(ctx));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body ?? "{}") as {
      ok: boolean;
      worksites: { issueKey: string; paths: string[] }[];
    };
    expect(body.ok).toBe(true);
    expect(body.worksites).toHaveLength(1);
    expect(body.worksites[0]?.issueKey).toBe("PROJ-1");
    expect(body.worksites[0]?.paths).toContain("src/billing/invoice.ts");
    expect(res.headers?.["Access-Control-Allow-Origin"]).toEqual(["*"]);
  });

  it("computes a REAL verdict against the live worksites", async () => {
    const { ctx } = await world();
    const res = await routeWebtrigger(
      post("/demo/verdict", { repo: "acme/billing", paths: "src/billing/invoice.ts" }),
      deps(ctx),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body ?? "{}") as {
      verdict: string;
      text: string;
      collisions: { degree: number; neighborIssueKey: string }[];
    };
    expect(body.verdict).toBe("caution");
    expect(body.collisions[0]?.degree).toBe(2);
    expect(body.collisions[0]?.neighborIssueKey).toBe("PROJ-1");
    expect(body.text).toContain("PROJ-1");
  });

  it("refuses any repository outside the allow-list", async () => {
    const { ctx } = await world();
    const res = await routeWebtrigger(
      post("/demo/verdict", { repo: "acme/secret-customer", paths: "src/x.ts" }),
      deps(ctx),
    );
    expect(res.statusCode).toBe(403);
  });

  it("asks for paths", async () => {
    const { ctx } = await world();
    const res = await routeWebtrigger(post("/demo/verdict", { repo: "acme/billing" }), deps(ctx));
    expect(res.statusCode).toBe(400);
  });
});

describe("/demo/state stays bounded whatever the volume", () => {
  it("resolves hundreds of collisions with a handful of store calls, not thousands", async () => {
    const stores = createMemoryStores();
    const clock = makeClock("2026-11-12T09:00:00.000Z");
    const repo = await stores.repos.ensure("PROJ", "acme/billing");
    await stores.zones.seedDefaults(repo.id);

    // 30 worksites (one footprint each) and 30 open collisions: a volume
    // where the old route would have issued ~30 footprint queries + 60
    // findById calls. It must stay at a constant handful.
    const ws: Worksite[] = [];
    for (let i = 0; i < 30; i += 1) {
      const w = await stores.worksites.create({
        issueKey: `PROJ-${i}`,
        repoId: repo.id,
        accountId: "lea@example.com",
        kind: "agent",
        state: "active",
        branch: `f/${i}`,
        openedAt: clock.now(),
        lastActivityAt: clock.now(),
      });
      await stores.footprints.add([
        {
          worksiteId: w.id,
          path: `src/f${i}.ts`,
          kind: "file",
          source: "declared",
          mode: "edit",
          at: clock.now(),
        },
      ]);
      ws.push(w);
    }
    for (let i = 0; i < 30; i += 1) {
      await stores.collisions.upsert({
        repoId: repo.id,
        worksiteA: ws[i].id,
        worksiteB: ws[(i + 1) % 30].id,
        path: `src/f${i}.ts`,
        degree: (i % 5) as Degree,
        rawDegree: (i % 5) as Degree,
        phase: "live",
      });
    }

    let listByWorksiteCalls = 0;
    let footprintListByRepoCalls = 0;
    let findByIdCalls = 0;
    let findByIdsCalls = 0;
    const fws = stores.footprints.listByWorksite.bind(stores.footprints);
    stores.footprints.listByWorksite = async (id) => {
      listByWorksiteCalls += 1;
      return fws(id);
    };
    const fbr = stores.footprints.listByRepo.bind(stores.footprints);
    stores.footprints.listByRepo = async (id) => {
      footprintListByRepoCalls += 1;
      return fbr(id);
    };
    const fbid = stores.worksites.findById.bind(stores.worksites);
    stores.worksites.findById = async (id) => {
      findByIdCalls += 1;
      return fbid(id);
    };
    const fids = stores.worksites.findByIds.bind(stores.worksites);
    stores.worksites.findByIds = async (ids) => {
      findByIdsCalls += 1;
      return fids(ids);
    };

    const ctx = {
      stores,
      now: () => clock.now(),
      identity: { accountId: "demo@example.com", kind: "human", client: "demo" },
      projectId: "PROJ",
    } as Ctx;
    const res = await routeWebtrigger(post("/demo/state", { repo: "acme/billing" }), deps(ctx));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body ?? "{}") as {
      worksites: unknown[];
      collisions: unknown[];
    };
    expect(body.worksites).toHaveLength(30);
    expect(body.collisions).toHaveLength(24); // capped at the worst

    // The N+1 is gone: every footprint via ONE repo query, every worksite
    // resolution via ONE batch query.
    expect(footprintListByRepoCalls).toBe(1);
    expect(listByWorksiteCalls).toBe(0);
    expect(findByIdCalls).toBe(0);
    expect(findByIdsCalls).toBeGreaterThanOrEqual(1);
    expect(findByIdsCalls).toBeLessThanOrEqual(3);
  });
});
