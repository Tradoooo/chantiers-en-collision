/**
 * tests/glue/proof-route — the PUBLIC proof route: aggregate counters only,
 * CORS open, no identifiers (no ticket key, no path, no account).
 */

import { describe, expect, it } from "vitest";
import { routeWebtrigger, type WebtriggerDeps } from "../../src/glue/webtrigger";

function deps(): WebtriggerDeps {
  return {
    buildCtx: async () => ({}) as never,
    verifyToken: async () => undefined,
    hookOpen: async () => ({ response: {} }),
    hookTouch: async () => ({}),
    hookClose: async () => undefined,
    ciFootprint: async () => ({ entries: 0 }),
    reportConflict: async () => ({}) as never,
    status: async () => ({
      generatedAt: "2026-11-12T15:00:00.000Z",
      repos: [
        { slug: "acme/billing", openWorksites: 13, openCollisions: 7, activeReservations: 1 },
      ],
      worksites: [
        { issueKey: "PROJ-88", state: "open", kind: "agent", lastActivityAt: "2026-11-12T14:00:00.000Z" },
      ],
      recentEvents: [{ at: "2026-11-12T14:59:00.000Z", kind: "footprint.declared" }],
    }),
    createToken: async () => ({ token: "t", tokenHash: "h", scope: "personal" }),
    ensureRepo: async () => ({}),
    tools: {},
  } as unknown as WebtriggerDeps;
}

describe("/proof route", () => {
  it("answers without a token, with aggregate counters only", async () => {
    const res = await routeWebtrigger(
      { method: "GET", path: "/public/abc123/proof", headers: {} },
      deps(),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body ?? "{}") as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.worksites).toBe(1);
    expect(body.collisions).toBe(7);
    expect(body.reservations).toBe(1);
    expect(body.events).toBe(1);
    // no identifier leaks in a public receipt
    expect(res.body).not.toContain("PROJ-88");
    expect(res.body).not.toContain("acme/billing");
  });

  it("opens CORS for the static site and forbids caching", async () => {
    const res = await routeWebtrigger(
      { method: "GET", path: "/public/abc123/proof", headers: {} },
      deps(),
    );
    expect(res.headers?.["Access-Control-Allow-Origin"]).toEqual(["*"]);
    expect(res.headers?.["Cache-Control"]).toEqual(["no-store"]);
  });
});
