/**
 * tests/glue/tool-route — the `/tool` route: a generic, token-gated RPC on
 * the ingest web trigger. It is what the local MCP bridge (and any agent
 * fleet) uses to call the app's tools without the platform's OAuth.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import { buildCtx } from "../../src/forge-context";
import { MCP_DEPS } from "../../src/glue/resolvers-mcp";
import {
  routeWebtrigger,
  type WebtriggerDeps,
  type WebtriggerRequest,
} from "../../src/glue/webtrigger";
import type { HookToken } from "../../src/core/types";
import type { Ctx } from "../../src/services/ctx";

const PERSONAL: HookToken = {
  accountId: "lea@example.com",
  tokenHash: "h-personal",
  scope: "personal",
  createdAt: "2026-11-11T09:00:00.000Z",
};

const PROJECT: HookToken = {
  accountId: "ci@example.com",
  tokenHash: "h-project",
  scope: "project",
  projectId: "PROJ",
  createdAt: "2026-11-11T09:00:00.000Z",
};

const realBuildCtx = MCP_DEPS.buildCtx;
let stores: ReturnType<typeof createMemoryStores>;
let clock: ReturnType<typeof makeClock>;

beforeEach(() => {
  stores = createMemoryStores();
  clock = makeClock("2026-11-11T09:00:00.000Z");
  MCP_DEPS.buildCtx = (options) => buildCtx({ ...options, stores, now: () => clock.now() });
});

afterEach(() => {
  MCP_DEPS.buildCtx = realBuildCtx;
});

function post(body: unknown, token: string): WebtriggerRequest {
  return {
    method: "POST",
    path: "/public/abc123/tool",
    headers: { authorization: [`Bearer ${token}`], "content-type": ["application/json"] },
    body: JSON.stringify(body),
  };
}

/** Deps with fakes: the token decides the identity, the tool is a spy. */
function depsWith(seen: { payload?: unknown; account?: string }): WebtriggerDeps {
  return {
    buildCtx: async () => ({}) as never,
    verifyToken: async (_ctx: Ctx, token: string) =>
      token === "tok_personal" ? PERSONAL : token === "tok_project" ? PROJECT : undefined,
    hookOpen: async () => ({ response: {} }),
    hookTouch: async () => ({}),
    hookClose: async () => undefined,
    ciFootprint: async () => ({ entries: 0 }),
    reportConflict: async () => ({}) as never,
    status: async () => ({}) as never,
    createToken: async () => ({ token: "t", tokenHash: "h", scope: "personal" }),
    ensureRepo: async () => ({}),
    tools: {
      "declare-footprint": async (request: { payload: Record<string, unknown>; context?: { accountId?: string } }) => {
        seen.payload = request.payload;
        seen.account = request.context?.accountId;
        return { tool: "declare-footprint", text: "verdict : caution" };
      },
    },
  } as unknown as WebtriggerDeps;
}

async function call(body: unknown, token: string, seen: { payload?: unknown; account?: string } = {}) {
  return routeWebtrigger(post(body, token), depsWith(seen));
}

describe("/tool route", () => {
  it("rejects a call without a tool name", async () => {
    const res = await call({}, "tok_personal");
    expect(res.statusCode).toBe(400);
  });

  it("answers 404 for an unknown tool", async () => {
    const res = await call({ tool: "does-not-exist" }, "tok_personal");
    expect(res.statusCode).toBe(404);
  });

  it("refuses a write tool to a project token (read-only scope)", async () => {
    const res = await call(
      { tool: "declare-footprint", payload: { issueKey: "PROJ-1", paths: "src/a.ts" } },
      "tok_project",
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("project token");
  });

  it("runs a tool for a personal token and returns its result", async () => {
    const seen: { payload?: unknown; account?: string } = {};
    const res = await call(
      { tool: "declare-footprint", payload: { issueKey: "PROJ-1", repo: "acme/billing", paths: "src/a.ts" } },
      "tok_personal",
      seen,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body ?? "{}") as { tool: string; text: string };
    expect(body.tool).toBe("declare-footprint");
    expect(body.text).toContain("verdict : caution");
    expect(seen.payload).toMatchObject({ issueKey: "PROJ-1", paths: "src/a.ts" });
  });

  it("takes the identity from the token, never from the payload (spec §9.6)", async () => {
    const seen: { payload?: unknown; account?: string } = {};
    await call(
      { tool: "declare-footprint", payload: { accountId: "attacker@example.com", issueKey: "PROJ-1" } },
      "tok_personal",
      seen,
    );
    expect(seen.account).toBe("lea@example.com");
  });
});
