/**
 * tests/glue/mcp-tools — the MCP glue on the REAL services, with memory stores.
 * Owner: workstream I.
 *
 * The services themselves are tested by workstreams G/H (tests/services). What
 * is checked here is the GLUE: payload parsing, the identity rules of spec §9.6
 * (the account comes from the Forge context, never from an input), the shape of
 * what a tool returns to an agent, and the wiring between tools (a declaration
 * is seen by the next check, a close releases the neighbour).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { Stores } from "../../src/storage/interfaces";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock, type TestClock } from "../../src/testing/clock";
import { buildCtx } from "../../src/forge-context";
import {
  MCP_DEPS,
  ToolInputError,
  checkZoneTool,
  closeWorksiteTool,
  declareFootprintTool,
  postNoticeTool,
  reserveZoneTool,
  whoTouchesTool,
  type ToolResult,
} from "../../src/glue/resolvers-mcp";

const LEA = "lea@example.com";
const MARC = "marc@example.com";
const REPO = "acme/billing";
const FILE = "src/billing/invoice.ts";

const realBuildCtx = MCP_DEPS.buildCtx;
let stores: Stores;
let clock: TestClock;

/** Route the glue's Ctx through memory stores + a controllable clock. */
function useMemoryStores(): void {
  stores = createMemoryStores();
  clock = makeClock("2026-11-11T09:00:00.000Z");
  MCP_DEPS.buildCtx = (options) => buildCtx({ ...options, stores, now: () => clock.now() });
}

afterEach(() => {
  MCP_DEPS.buildCtx = realBuildCtx;
});

function call(accountId: string, payload: Record<string, unknown>) {
  return { payload, context: { accountId } };
}

function declareAs(
  accountId: string,
  issueKey: string,
  paths: string,
  session?: string,
): Promise<ToolResult> {
  const payload: Record<string, unknown> = { issueKey, repo: REPO, paths };
  if (session !== undefined) payload.session = session;
  return declareFootprintTool(call(accountId, payload));
}

describe("MCP glue — declare / check / who", () => {
  it("answers a free verdict with the text an agent reads", async () => {
    useMemoryStores();
    const result = await declareAs(LEA, "PROJ-88", FILE, "sess-lea");
    expect(result.tool).toBe("declare-footprint");
    expect(result.verdict).toBe("free");
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(Array.isArray(result.collisions)).toBe(true);
  });

  it("flags the second agent on the same file and names the neighbour", async () => {
    useMemoryStores();
    await declareAs(LEA, "PROJ-88", FILE, "sess-lea");
    clock.advance(5);
    const second = await declareAs(MARC, "PROJ-101", FILE, "sess-marc");

    expect(second.verdict).not.toBe("free");
    const collisions = second.collisions as { neighbor: { issueKey: string } }[];
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0].neighbor.issueKey).toBe("PROJ-88");
    expect(second.text).toContain("PROJ-88");
  });

  it("check-zone is read-only and sees the same collision", async () => {
    useMemoryStores();
    await declareAs(LEA, "PROJ-88", FILE, "sess-lea");
    const probe = await checkZoneTool(call(MARC, { repo: REPO, paths: FILE, issueKey: "PROJ-101" }));

    expect(probe.verdict).not.toBe("free");
    expect(await stores.worksites.findByIssue("PROJ-101")).toEqual([]);
  });

  it("who-touches lists the worksites present on the path", async () => {
    useMemoryStores();
    await declareAs(LEA, "PROJ-88", FILE, "sess-lea");
    const who = await whoTouchesTool(call(MARC, { repo: REPO, path: FILE }));

    expect(who.count).toBeGreaterThan(0);
    const neighbors = who.neighbors as { issueKey: string }[];
    expect(neighbors.map((n) => n.issueKey)).toContain("PROJ-88");
  });
});

describe("MCP glue — identity (§9.6)", () => {
  it("takes the account from the context, never from the payload", async () => {
    useMemoryStores();
    await declareFootprintTool({
      payload: {
        issueKey: "PROJ-88",
        repo: REPO,
        paths: FILE,
        session: "sess-lea",
        // Hostile inputs: none of them may become the identity.
        accountId: "attacker@example.com",
        account: "attacker@example.com",
        kind: "human",
        client: "evil",
      },
      context: { accountId: LEA },
    });

    const worksites = await stores.worksites.findByIssue("PROJ-88");
    expect(worksites.length).toBe(1);
    expect(worksites[0].accountId).toBe(LEA);
    expect(worksites[0].kind).toBe("agent"); // a session reference ⇒ agent session
  });

  it("derives the project from the issue key and refuses a missing input", async () => {
    useMemoryStores();
    await declareAs(LEA, "OTHER-7", FILE);
    expect(await stores.repos.findBySlug("OTHER", REPO)).toBeDefined();
    await expect(declareFootprintTool(call(LEA, { repo: REPO, paths: FILE }))).rejects.toBeInstanceOf(
      ToolInputError,
    );
  });
});

describe("MCP glue — notice, reservation, close", () => {
  it("posts a notice that the neighbour receives once", async () => {
    useMemoryStores();
    await declareAs(LEA, "PROJ-88", FILE, "sess-lea");
    await declareAs(MARC, "PROJ-101", FILE, "sess-marc");
    const posted = await postNoticeTool(
      call(LEA, { issueKey: "PROJ-88", repo: REPO, paths: FILE, text: "renaming total to total_cents" }),
    );
    expect(posted.tool).toBe("post-notice");
    expect((posted.recipients as unknown[]).length).toBeGreaterThan(0);

    const next = await declareAs(MARC, "PROJ-101", FILE, "sess-marc");
    expect(JSON.stringify(next.pendingNotices)).toContain("total_cents");
  });

  it("reserves a zone and says so, or refuses with a reason", async () => {
    useMemoryStores();
    const reserved = await reserveZoneTool(
      call(LEA, { issueKey: "PROJ-88", repo: REPO, paths: "db/migrations", minutes: 60 }),
    );
    expect(reserved.refused).toBe(false);
    expect(reserved.text).toContain("reserved until");
  });

  it("closing a worksite releases the neighbour that was waiting", async () => {
    useMemoryStores();
    await declareAs(LEA, "PROJ-88", FILE, "sess-lea");
    const blocked = await declareAs(MARC, "PROJ-101", FILE, "sess-marc");
    expect(blocked.verdict).not.toBe("free");

    const closed = await closeWorksiteTool(
      call(LEA, { issueKey: "PROJ-88", repo: REPO, session: "sess-lea", outcome: "merged" }),
    );
    expect(closed.tool).toBe("close-worksite");
    expect((closed.closed as unknown[]).length).toBe(1);

    const after = await checkZoneTool(call(MARC, { repo: REPO, paths: FILE, issueKey: "PROJ-101" }));
    expect(after.verdict).toBe("free");
  });
});
