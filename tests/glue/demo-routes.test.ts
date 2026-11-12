/**
 * tests/glue/demo-routes — the PUBLIC demo routes: the real state of the
 * demo repository and a real verdict for a path, computed against the live
 * worksites. Only the allow-listed demo repo may be read.
 */

import { describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import type { Ctx } from "../../src/services/ctx";
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
