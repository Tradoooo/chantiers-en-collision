/**
 * tests/glue/webtrigger-routing — the `ingest` web trigger as a PURE function.
 * Owner: workstream I. No Forge, no network, no real service: every
 * collaborator is a spy injected through `WebtriggerDeps`.
 *
 * Covers the three properties the endpoint must guarantee:
 *  (a) SANITIZATION (§17) — from a raw PreToolUse event, only the path, the
 *      session and the working directory reach the service; `old_string`,
 *      `new_string` and any other content are dropped before processing.
 *  (b) FAIL-OPEN (§20) — anything that goes wrong answers 200 with an empty
 *      body, and never throws: the agent keeps working.
 *  (c) ROUTING — each URL suffix reaches its own service, and a PROJECT token
 *      is refused on the hook routes (`/ci/*` only).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../../src/services/ctx";
import type { HookToken, Identity } from "../../src/core/types";
import {
  routeOf,
  routeWebtrigger,
  sanitizeTouch,
  type WebtriggerDeps,
  type WebtriggerRequest,
} from "../../src/glue/webtrigger";

const NOW = "2026-11-11T09:00:00.000Z";
const PERSONAL_TOKEN: HookToken = {
  accountId: "pilot-lea",
  tokenHash: "hash-personal",
  scope: "personal",
  createdAt: NOW,
};
const PROJECT_TOKEN: HookToken = {
  accountId: "ci-bot",
  tokenHash: "hash-project",
  scope: "project",
  projectId: "PROJ",
  createdAt: NOW,
};

const IDENTITY: Identity = { accountId: "pilot-lea", kind: "agent", client: "hook" };

function fakeCtx(): Ctx {
  return {
    stores: {} as Ctx["stores"],
    now: () => NOW,
    identity: IDENTITY,
    projectId: "PROJ",
  };
}

interface Spies {
  deps: WebtriggerDeps;
  buildCtx: ReturnType<typeof vi.fn>;
  verifyToken: ReturnType<typeof vi.fn>;
  hookOpen: ReturnType<typeof vi.fn>;
  hookTouch: ReturnType<typeof vi.fn>;
  hookClose: ReturnType<typeof vi.fn>;
  ciFootprint: ReturnType<typeof vi.fn>;
  reportConflict: ReturnType<typeof vi.fn>;
}

/** Spies for every collaborator; `token` is what verification returns. */
function makeSpies(token: HookToken | undefined = PERSONAL_TOKEN): Spies {
  const buildCtx = vi.fn(async () => fakeCtx());
  const verifyToken = vi.fn(async () => token);
  const hookOpen = vi.fn(async () => ({ response: { additionalContext: "3 neighbours" } }));
  const hookTouch = vi.fn(async () => ({ additionalContext: "PROJ-88 edits this file" }));
  const hookClose = vi.fn(async () => undefined);
  const ciFootprint = vi.fn(async () => ({ entries: 2 }));
  const reportConflict = vi.fn(async () => ({
    id: "rc-1",
    repoId: "repo-1",
    paths: ["src/billing/invoice.ts"],
    wasDetected: true,
    reportedAt: NOW,
  }));
  const deps: WebtriggerDeps = {
    buildCtx,
    verifyToken,
    hookOpen,
    hookTouch,
    hookClose,
    ciFootprint,
    reportConflict,
  };
  return { buildCtx, verifyToken, hookOpen, hookTouch, hookClose, ciFootprint, reportConflict, deps };
}

function request(path: string, body: unknown, token = "tok_personal"): WebtriggerRequest {
  return {
    method: "POST",
    path,
    headers: { authorization: [`Bearer ${token}`], "content-type": ["application/json"] },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

/** A raw PreToolUse event, with the file content an agent client really sends. */
function rawTouchEvent(): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: "sess-42",
    cwd: "/home/dev/billing",
    tool_name: "Edit",
    // The attacker-controlled fields an identity must never come from (§9.6):
    account_id: "attacker",
    client: "evil-client",
    tool_input: {
      file_path: "/home/dev/billing/src/billing/invoice.ts",
      old_string: `OLD${"x".repeat(20000)}`,
      new_string: `NEW${"y".repeat(20000)}`,
      content: "SECRET-CONTENT",
    },
    prompt: "SECRET-PROMPT",
  };
}

function bodyOf(response: { body?: string }): Record<string, unknown> {
  return JSON.parse(response.body ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* (a) sanitization                                                     */
/* ------------------------------------------------------------------ */

describe("sanitization (§17)", () => {
  it("keeps only path, session and cwd — never the file content", async () => {
    const spies = makeSpies();
    await routeWebtrigger(request("/ingest/touch", rawTouchEvent()), spies.deps);

    expect(spies.hookTouch).toHaveBeenCalledTimes(1);
    const event = spies.hookTouch.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(["cwd", "path", "repoSlug", "sessionRef"]);
    expect(event.path).toBe("/home/dev/billing/src/billing/invoice.ts");
    expect(event.sessionRef).toBe("sess-42");
    expect(event.cwd).toBe("/home/dev/billing");
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("xxxx");
    expect(serialized).not.toContain("SECRET-CONTENT");
  });

  it("drops the content before anything else sees it (pure sanitizer)", () => {
    const sanitized = sanitizeTouch(rawTouchEvent());
    expect(sanitized?.hookEventName).toBe("PreToolUse");
    expect(JSON.stringify(sanitized?.event)).not.toContain("SECRET");
    expect(sanitized?.event).toEqual({
      sessionRef: "sess-42",
      path: "/home/dev/billing/src/billing/invoice.ts",
      cwd: "/home/dev/billing",
    });
  });

  it("keeps agent_id/agent_type and nothing more", () => {
    const raw = rawTouchEvent();
    raw.agent_id = "sub-7";
    raw.agent_type = "task";
    const sanitized = sanitizeTouch(raw);
    expect(sanitized?.event).toEqual({
      sessionRef: "sess-42",
      path: "/home/dev/billing/src/billing/invoice.ts",
      cwd: "/home/dev/billing",
      agentRef: "sub-7",
      agentType: "task",
    });
  });

  it("takes the identity from the verified token, never from the body (§9.6)", async () => {
    const spies = makeSpies();
    await routeWebtrigger(request("/ingest/touch", rawTouchEvent()), spies.deps);

    const options = spies.buildCtx.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(options.token).toEqual(PERSONAL_TOKEN);
    expect(options.accountId).toBeUndefined();
    expect(options.client).toBe("hook");
    expect(options.sessionRef).toBe("sess-42");
    expect(JSON.stringify(options)).not.toContain("attacker");
    expect(JSON.stringify(options)).not.toContain("evil-client");
  });

  it("ignores an unusable event instead of guessing", async () => {
    const spies = makeSpies();
    const response = await routeWebtrigger(
      request("/ingest/touch", { tool_input: { old_string: "no path here" } }),
      spies.deps,
    );
    expect(spies.hookTouch).not.toHaveBeenCalled();
    expect(response).toEqual({ statusCode: 200, body: "" });
  });
});

/* ------------------------------------------------------------------ */
/* (b) fail-open                                                        */
/* ------------------------------------------------------------------ */

describe("fail-open (§20)", () => {
  it("answers 200 with an empty body when the service throws", async () => {
    const spies = makeSpies();
    spies.hookTouch.mockRejectedValueOnce(new Error("boom"));
    const response = await routeWebtrigger(request("/ingest/touch", rawTouchEvent()), spies.deps);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  });

  it("answers 200 empty when token verification throws", async () => {
    const spies = makeSpies();
    spies.verifyToken.mockRejectedValueOnce(new Error("database down"));
    const response = await routeWebtrigger(request("/ingest/touch", rawTouchEvent()), spies.deps);
    expect(response).toEqual({ statusCode: 200, body: "" });
    expect(spies.hookTouch).not.toHaveBeenCalled();
  });

  it("answers 200 empty on a malformed body, an unknown route, no token", async () => {
    const spies = makeSpies();
    expect(await routeWebtrigger(request("/ingest/touch", "{not json"), spies.deps)).toEqual({
      statusCode: 200,
      body: "",
    });
    expect(await routeWebtrigger(request("/ingest/nope", {}), spies.deps)).toEqual({
      statusCode: 200,
      body: "",
    });
    const anonymous = request("/ingest/touch", rawTouchEvent());
    delete anonymous.headers?.authorization;
    expect(await routeWebtrigger(anonymous, spies.deps)).toEqual({ statusCode: 200, body: "" });
    expect(spies.hookTouch).not.toHaveBeenCalled();
  });

  it("never throws, whatever the request looks like", async () => {
    const spies = makeSpies();
    const broken: WebtriggerRequest = { path: "/ingest/open" };
    await expect(routeWebtrigger(broken, spies.deps)).resolves.toEqual({ statusCode: 200, body: "" });
  });
});

/* ------------------------------------------------------------------ */
/* (c) routing + token scopes                                           */
/* ------------------------------------------------------------------ */

describe("routing", () => {
  it("matches the v2 URL by suffix", () => {
    expect(routeOf("/v2/ari-app/ingest/touch")).toBe("touch");
    expect(routeOf("https://x.webtrigger.atlassian.app/v2/app/ingest/open")).toBe("open");
    expect(routeOf("/ingest/close/")).toBe("close");
    expect(routeOf("/ingest/ci/footprint?x=1")).toBe("ci-footprint");
    expect(routeOf("/ingest/ci/conflict")).toBe("ci-conflict");
    expect(routeOf("/ingest/unknown")).toBeUndefined();
    expect(routeOf(undefined)).toBeUndefined();
  });

  it("/open → hookOpen, and answers SessionStart context", async () => {
    const spies = makeSpies();
    const response = await routeWebtrigger(
      request("/ingest/open", { sessionRef: "s1", branch: "feature/PROJ-88", cwd: "/repo" }),
      spies.deps,
    );
    expect(spies.hookOpen).toHaveBeenCalledTimes(1);
    expect(spies.hookOpen.mock.calls[0][1]).toEqual({ sessionRef: "s1", branch: "feature/PROJ-88", cwd: "/repo" });
    expect(bodyOf(response)).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "3 neighbours" },
    });
  });

  it("/touch → hookTouch, and answers PreToolUse context", async () => {
    const spies = makeSpies();
    const response = await routeWebtrigger(request("/ingest/touch", rawTouchEvent()), spies.deps);
    expect(spies.hookTouch).toHaveBeenCalledTimes(1);
    expect(bodyOf(response)).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "PROJ-88 edits this file" },
    });
  });

  it("/touch answers a hard-mode deny with permissionDecision", async () => {
    const spies = makeSpies();
    spies.hookTouch.mockResolvedValueOnce({ deny: { reason: "db/migrations/ is reserved by PROJ-88" } });
    const response = await routeWebtrigger(request("/ingest/touch", rawTouchEvent()), spies.deps);
    expect(bodyOf(response)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "db/migrations/ is reserved by PROJ-88",
      },
    });
  });

  it("/close → hookClose, empty body (SessionEnd output is unused)", async () => {
    const spies = makeSpies();
    const response = await routeWebtrigger(
      request("/ingest/close", { sessionRef: "s1", reason: "session-end" }),
      spies.deps,
    );
    expect(spies.hookClose).toHaveBeenCalledTimes(1);
    expect(spies.hookClose.mock.calls[0][1]).toEqual({ sessionRef: "s1", reason: "session-end" });
    expect(response).toEqual({ statusCode: 200, body: "" });
  });

  it("/ci/footprint → ciFootprint with the attested file list", async () => {
    const spies = makeSpies(PROJECT_TOKEN);
    const response = await routeWebtrigger(
      request("/ingest/ci/footprint", {
        repoSlug: "acme/billing",
        branch: "feature/PROJ-88",
        baseBranch: "main",
        issueKey: "PROJ-88",
        files: ["src/a.ts", "src/b.ts"],
        prOpen: true,
      }),
      spies.deps,
    );
    expect(spies.ciFootprint).toHaveBeenCalledTimes(1);
    expect(spies.ciFootprint.mock.calls[0][1]).toEqual({
      repoSlug: "acme/billing",
      branch: "feature/PROJ-88",
      baseBranch: "main",
      issueKey: "PROJ-88",
      files: ["src/a.ts", "src/b.ts"],
      prOpen: true,
    });
    expect(bodyOf(response)).toEqual({ ok: true, entries: 2, worksiteId: undefined, issueKey: "PROJ-88" });
    expect((spies.buildCtx.mock.calls.at(-1)?.[0] as Record<string, unknown>).client).toBe("ci");
  });

  it("/ci/conflict → reportConflict, and says whether it was detected", async () => {
    const spies = makeSpies(PROJECT_TOKEN);
    const response = await routeWebtrigger(
      request("/ingest/ci/conflict", {
        issueKey: "PROJ-101",
        repoSlug: "acme/billing",
        paths: "src/billing/invoice.ts\nsrc/billing/tax.ts",
        withIssueKey: "PROJ-88",
      }),
      spies.deps,
    );
    expect(spies.reportConflict).toHaveBeenCalledTimes(1);
    expect(spies.reportConflict.mock.calls[0][1]).toEqual({
      issueKey: "PROJ-101",
      repoSlug: "acme/billing",
      paths: "src/billing/invoice.ts\nsrc/billing/tax.ts",
      withIssueKey: "PROJ-88",
    });
    expect(bodyOf(response)).toEqual({ ok: true, conflictId: "rc-1", wasDetected: true });
  });

  it("refuses a PROJECT token on the hook routes (no service call, fail-open)", async () => {
    const spies = makeSpies(PROJECT_TOKEN);
    for (const path of ["/ingest/touch", "/ingest/open", "/ingest/close"]) {
      const response = await routeWebtrigger(request(path, rawTouchEvent()), spies.deps);
      expect(response).toEqual({ statusCode: 200, body: "" });
    }
    expect(spies.hookTouch).not.toHaveBeenCalled();
    expect(spies.hookOpen).not.toHaveBeenCalled();
    expect(spies.hookClose).not.toHaveBeenCalled();
  });

  it("accepts a PERSONAL token on the CI routes", async () => {
    const spies = makeSpies(PERSONAL_TOKEN);
    await routeWebtrigger(
      request("/ingest/ci/footprint", { repoSlug: "acme/billing", branch: "b", files: ["a.ts"] }),
      spies.deps,
    );
    expect(spies.ciFootprint).toHaveBeenCalledTimes(1);
  });

  it("says 401 to a pipeline with an unknown token, and 400 on a bad body", async () => {
    const noToken = makeSpies();
    noToken.verifyToken.mockResolvedValueOnce(undefined); // unknown/revoked token
    const refused = await routeWebtrigger(
      request("/ingest/ci/footprint", { repoSlug: "a/b", branch: "b", files: ["a.ts"] }),
      noToken.deps,
    );
    expect(refused.statusCode).toBe(401);

    const spies = makeSpies(PROJECT_TOKEN);
    const bad = await routeWebtrigger(request("/ingest/ci/footprint", { branch: "b" }), spies.deps);
    expect(bad.statusCode).toBe(400);
    expect(spies.ciFootprint).not.toHaveBeenCalled();
  });
});
