import { describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import type { Ctx } from "../../src/services/ctx";
import type { Identity } from "../../src/core/types";
import { declareFootprint, checkZone } from "../../src/services/declare";
import { closeWorksite, getWorksitePanel, markActivity, whoTouches } from "../../src/services/worksites";
import { postNotice } from "../../src/services/notices";
import { reserveZone } from "../../src/services/reservations";
import { resolveCollision } from "../../src/services/resolve";
import { createToken, verifyToken } from "../../src/services/tokens";
import { ciFootprint, hookClose, hookTouch, reportConflict } from "../../src/services/ingest";
import { sweep } from "../../src/services/maintenance";

const REPO = "acme/billing";

function makeCtx(actor: Partial<Identity> = {}, projectId = "PROJ") {
  const stores = createMemoryStores();
  const clock = makeClock("2026-11-11T09:00:00.000Z");
  const identity: Identity = {
    accountId: "lea@example.com",
    kind: "agent",
    client: "claude-code",
    ...actor,
  };
  return { stores, clock, ctx: { stores, now: () => clock.now(), identity, projectId } as Ctx };
}

/** Same stores/clock, different caller. */
function asCtx(base: ReturnType<typeof makeCtx>, actor: Partial<Identity>): Ctx {
  return {
    stores: base.stores,
    now: () => base.clock.now(),
    identity: {
      accountId: "lea@example.com",
      kind: "agent",
      client: "claude-code",
      ...actor,
    },
    projectId: "PROJ",
  } as Ctx;
}

describe("declareFootprint", () => {
  it("spec §22.1 — dir vs file inside: caution D2 with the neighbour named", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    const a = await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/", session: "s1",
    });
    expect(a.kind).toBe("free");

    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    const b = await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s2",
    });
    expect(b.kind).toBe("caution");
    expect(b.collisions[0]?.degree).toBe(2);
    expect(b.collisions[0]?.neighbor.issueKey).toBe("PROJ-88");
    expect(b.text).toContain("PROJ-88");
    expect(b.text).toContain("src/billing/invoice.ts");
  });

  it("spec §22.2 — two sessions of one pilot collide, flagged samePilot", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1",
    });
    const twin = asCtx(base, { sessionRef: "s2" });
    const v = await declareFootprint(twin, {
      issueKey: "PROJ-90", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s2",
    });
    expect(v.collisions).toHaveLength(1);
    expect(v.collisions[0]?.samePilot).toBe(true);
    expect(v.text).toContain("your two agents");
  });

  it("spec §22.3 — second worksite in migrations: wait D4 exclusive", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "db/migrations/0042_a.sql", session: "s1",
    });
    const other = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    const v = await declareFootprint(other, {
      issueKey: "PROJ-93", repoSlug: REPO, paths: "db/migrations/0043_b.sql", session: "s2",
    });
    expect(v.kind).toBe("wait");
    expect(v.collisions[0]?.degree).toBe(4);
    expect(v.collisions[0]?.zoneName).toBe("migrations");
  });

  it("redeclaring after a drift keeps one entry per path and notes the gap", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/a.ts\nsrc/b.ts", session: "s1",
    });
    const v = await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/a.ts\nsrc/c.ts", session: "s1",
    });
    const panel = await getWorksitePanel(base.ctx, "PROJ-88");
    const declared = panel.repos[0]?.footprintsBySource.declared ?? [];
    expect(declared.map((e) => e.path).sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(v.kind).toBe("free");
  });

  it("huge declarations suggest a freeze instead of hundreds of collisions", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    const paths = Array.from({ length: 60 }, (_, i) => `src/f${i}.ts`).join("\n");
    const v = await declareFootprint(base.ctx, { issueKey: "PROJ-88", repoSlug: REPO, paths, session: "s1" });
    expect(v.freezeSuggestion?.paths).toBe(60);
  });
});

describe("checkZone", () => {
  it("answers without persisting anything (spec §22: read-only probe)", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1",
    });
    const before = (await base.stores.worksites.listOpenByRepo(
      (await base.stores.repos.findBySlug("PROJ", REPO))!.id,
    )).length;

    const probe = asCtx(base, { accountId: "sam@example.com" });
    const v = await checkZone(probe, { repoSlug: REPO, paths: "src/billing/invoice.ts" });
    expect(v.kind).toBe("caution");
    expect(v.collisions[0]?.neighbor.issueKey).toBe("PROJ-88");

    const after = (await base.stores.worksites.listOpenByRepo(
      (await base.stores.repos.findBySlug("PROJ", REPO))!.id,
    )).length;
    expect(after).toBe(before);
  });
});

describe("notices — spec §22.8", () => {
  it("a notice is delivered ONCE with the next tool response", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1",
    });
    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s2",
    });
    const posted = await postNotice(base.ctx, {
      issueKey: "PROJ-88", paths: "src/billing/invoice.ts", text: "renaming total to total_cents",
    });
    expect(posted.recipients.map((r) => r.issueKey)).toEqual(["PROJ-101"]);

    const first = await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s2",
    });
    expect(first.pendingNotices).toHaveLength(1);
    expect(first.text).toContain("renaming total to total_cents");

    const second = await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s2",
    });
    expect(second.pendingNotices).toHaveLength(0);
  });
});

describe("reservations — spec §11", () => {
  it("defaults to two hours and refuses an overlapping foreign reservation", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    const r = await reserveZone(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "db/migrations", reason: "renumbering",
    });
    expect("refused" in r && r.refused).toBeFalsy();
    if (!("refused" in r)) {
      expect(r.expiresAt).toBe("2026-11-11T11:00:00.000Z");
    }
    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    const refused = await reserveZone(karim, {
      issueKey: "PROJ-93", repoSlug: REPO, paths: "db/migrations/0043.sql",
    });
    expect("refused" in refused && refused.refused).toBe(true);
  });

  it("clamps the duration to 24 h — nothing eternal", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    const r = await reserveZone(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "db/migrations", minutes: 99999,
    });
    if (!("refused" in r)) {
      expect(r.expiresAt).toBe("2026-11-12T09:00:00.000Z");
    }
  });

  it("spec §22.6 — after expiry (sweep), the next declaration is free", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await reserveZone(base.ctx, { issueKey: "PROJ-88", repoSlug: REPO, paths: "db/migrations", minutes: 60 });
    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    base.clock.advance(120);
    const swept = await sweep(asCtx(base, { accountId: "system", kind: "human" }));
    expect(swept.expiredReservations).toHaveLength(1);
    const v = await declareFootprint(karim, {
      issueKey: "PROJ-93", repoSlug: REPO, paths: "db/migrations/0043.sql", session: "s2",
    });
    expect(v.kind).toBe("free");
  });
});

describe("resolveCollision — spec §8", () => {
  async function collisionSetup() {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1",
    });
    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    const v = await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s2",
    });
    return { base, karim, collisionId: v.collisions[0]!.collisionId };
  }

  it("wait designates who yields and records the resolution", async () => {
    const { base, collisionId } = await collisionSetup();
    const out = await resolveCollision(base.ctx, { collisionId, choice: "wait" });
    expect(out.recorded).toBe(true);
    expect(out.yieldsWorksiteId).toBeDefined();
  });

  it("sequence produces the 'is blocked by' link", async () => {
    const { base, collisionId } = await collisionSetup();
    const out = await resolveCollision(base.ctx, { collisionId, choice: "sequence" });
    expect(out.linkToCreate).toBeDefined();
    expect([out.linkToCreate?.blockedIssueKey, out.linkToCreate?.blockerIssueKey].sort()).toEqual(
      ["PROJ-101", "PROJ-88"].sort(),
    );
  });

  it("override requires a reason", async () => {
    const { base, collisionId } = await collisionSetup();
    await expect(resolveCollision(base.ctx, { collisionId, choice: "override" })).rejects.toThrow(
      /reason/,
    );
    const out = await resolveCollision(base.ctx, {
      collisionId, choice: "override", reason: "hotfix, coordinated orally",
    });
    expect(out.recorded).toBe(true);
  });

  it("split prepares a draft ticket; coordinate notifies the neighbour", async () => {
    const { base, collisionId } = await collisionSetup();
    const split = await resolveCollision(base.ctx, { collisionId, choice: "split" });
    expect(split.splitTicketDraft?.summary).toContain("src/billing/invoice.ts");

    const second = await collisionSetup();
    const coord = await resolveCollision(second.base.ctx, {
      collisionId: second.collisionId, choice: "coordinate",
    });
    expect(coord.noticeSent).toBe(true);
  });
});

describe("closeWorksite — spec §22.12", () => {
  it("closing releases the waiting neighbour", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "db/migrations/0042.sql", session: "s1",
    });
    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    const blocked = await declareFootprint(karim, {
      issueKey: "PROJ-93", repoSlug: REPO, paths: "db/migrations/0043.sql", session: "s2",
    });
    expect(blocked.kind).toBe("wait");

    const res = await closeWorksite(base.ctx, { issueKey: "PROJ-88", outcome: "merged" });
    expect(res.closed).toHaveLength(1);
    expect(res.released.map((n) => n.issueKey)).toEqual(["PROJ-93"]);

    const after = await declareFootprint(karim, {
      issueKey: "PROJ-93", repoSlug: REPO, paths: "db/migrations/0043.sql", session: "s2",
    });
    expect(after.kind).toBe("free");
  });
});

describe("tokens — spec §17", () => {
  it("stores only the hash and verifies the clear token once shown", async () => {
    const base = makeCtx({ accountId: "lea@example.com", kind: "human" });
    const created = await createToken(base.ctx, "personal");
    expect(created.token).not.toBe(created.tokenHash);
    const found = await verifyToken(base.ctx, created.token);
    expect(found?.accountId).toBe("lea@example.com");
    expect(await verifyToken(base.ctx, "bogus")).toBeUndefined();
    const stored = await base.stores.tokens.listByAccount("lea@example.com");
    expect(JSON.stringify(stored)).not.toContain(created.token);
  });
});

describe("hook ingest — spec §9.3, §22.4-5-11", () => {
  async function openedSession(base: ReturnType<typeof makeCtx>, sessionRef: string) {
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: sessionRef,
    });
  }

  it("§22.4 — an undeclared touch widens the footprint and notes the gap", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await openedSession(base, "s1");
    await hookTouch(base.ctx, { sessionRef: "s1", path: "/work/src/billing/extra.ts", cwd: "/work", repoSlug: REPO });
    const panel = await getWorksitePanel(base.ctx, "PROJ-88");
    const observed = panel.repos[0]?.footprintsBySource.observed ?? [];
    expect(observed.map((e) => e.path)).toContain("src/billing/extra.ts");
    expect(observed.some((e) => e.declaredMismatch)).toBe(true);
  });

  it("a touch colliding with a neighbour warns the agent", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await openedSession(base, "s1");
    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "src/billing/tax.ts", session: "s2",
    });
    const res = await hookTouch(karim, {
      sessionRef: "s2", path: "/work/src/billing/invoice.ts", cwd: "/work", repoSlug: REPO,
    });
    expect(res.additionalContext).toContain("PROJ-88");
  });

  it("§22.11 — a failing store never blocks: fail-open with an empty response", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await openedSession(base, "s1");
    const broken = asCtx(base, { sessionRef: "s1" });
    const original = broken.stores.footprints.add;
    broken.stores.footprints.add = async () => {
      throw new Error("database on fire");
    };
    await expect(
      hookTouch(broken, { sessionRef: "s1", path: "/work/src/x.ts", cwd: "/work", repoSlug: REPO }),
    ).resolves.toEqual({});
    broken.stores.footprints.add = original;
  });

  it("§22.5 — hard mode denies inside a foreign hard reservation", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await base.stores.rules.set({
      projectId: "PROJ", order: ["reservation"], agentYields: true, hardMode: true, dormancyHours: 24,
    });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/locked.ts", session: "s1",
    });
    const res = await reserveZone(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/locked.ts", hard: true, minutes: 60,
    });
    expect("refused" in res && res.refused).toBeFalsy();

    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "src/other.ts", session: "s2",
    });
    const denied = await hookTouch(karim, {
      sessionRef: "s2", path: "/work/src/billing/locked.ts", cwd: "/work", repoSlug: REPO,
    });
    expect(denied.deny?.reason).toContain("hard mode");
  });

  it("hookClose pauses the worksite", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await openedSession(base, "s1");
    await hookClose(base.ctx, { sessionRef: "s1" });
    const panel = await getWorksitePanel(base.ctx, "PROJ-88");
    expect(panel.repos[0]?.worksites[0]?.state).toBe("paused");
  });
});

describe("CI ingest — spec §10, §22.10", () => {
  it("a branch push attests the footprint of a developer with no tooling", async () => {
    const base = makeCtx({ accountId: "dev@example.com", kind: "human", client: "ci" });
    const res = await ciFootprint(base.ctx, {
      repoSlug: REPO, branch: "PROJ-77-fix-total", files: ["src/billing/invoice.ts", "src/billing/tax.ts"],
    });
    expect(res.entries).toBe(2);
    const panel = await getWorksitePanel(base.ctx, "PROJ-77");
    expect(panel.repos[0]?.footprintsBySource.attested).toHaveLength(2);
    expect(res.worksite?.state).toBe("open");
  });

  it("a push on the default branch closes the worksite as merged", async () => {
    const base = makeCtx({ accountId: "dev@example.com", kind: "human", client: "ci" });
    await ciFootprint(base.ctx, { repoSlug: REPO, branch: "PROJ-77-fix", files: ["src/a.ts"] });
    const res = await ciFootprint(base.ctx, { repoSlug: REPO, branch: "main", files: ["src/a.ts"], issueKey: "PROJ-77" });
    expect(res.worksite?.state).toBe("closed");
    expect(res.worksite?.outcome).toBe("merged");
  });
});

describe("conflicts and activity", () => {
  it("reportConflict knows whether the collision was detected", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1",
    });
    const karim = asCtx(base, { accountId: "karim@example.com", sessionRef: "s2" });
    await declareFootprint(karim, {
      issueKey: "PROJ-101", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s2",
    });
    const seen = await reportConflict(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", withIssueKey: "PROJ-101",
    });
    expect(seen.wasDetected).toBe(true);
    const missed = await reportConflict(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "docs/never-declared.md",
    });
    expect(missed.wasDetected).toBe(false);
  });

  it("markActivity wakes a dormant worksite; whoTouches lists occupants", async () => {
    const base = makeCtx({ sessionRef: "s1" });
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-88", repoSlug: REPO, paths: "src/billing/invoice.ts", session: "s1",
    });
    const repo = (await base.stores.repos.findBySlug("PROJ", REPO))!;
    const w = (await base.stores.worksites.findByIssue("PROJ-88", repo.id))[0]!;
    await base.stores.worksites.update(w.id, { state: "dormant" });
    await markActivity(base.ctx, w.id);
    const after = await base.stores.worksites.findById(w.id);
    expect(after?.state).toBe("active");

    const touchers = await whoTouches(base.ctx, { repoSlug: REPO, path: "src/billing/invoice.ts" });
    expect(touchers.map((t) => t.issueKey)).toEqual(["PROJ-88"]);
  });
});
