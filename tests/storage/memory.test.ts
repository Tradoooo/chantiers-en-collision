/**
 * tests/storage/memory.test.ts — the in-memory stores (workstream F).
 *
 * Every store of src/storage/interfaces.ts is exercised against the real
 * implementation (createMemoryStores), on the semantics documented in the
 * interface: find-or-create repos, idempotent zone catalog, session upsert,
 * non-closed worksites, footprint dedup and source/mode hierarchy, overlap
 * search, one collision per (pair, zone), active reservations, notices
 * delivered once, and defensive copies.
 */

import { describe, expect, it } from "vitest";
import { classifyPath } from "../../src/core/paths";
import { DEFAULT_PRIORITY_RULES } from "../../src/core/types";
import type {
  CollisionDraft,
  FootprintEntryInput,
  PriorityRules,
  RepoRecord,
  Worksite,
} from "../../src/core/types";
import { createMemoryStores } from "../../src/storage/memory";
import { plusMinutes } from "../../src/testing/clock";

const T0 = "2026-11-11T09:00:00.000Z";
const at = (minutes: number): string => plusMinutes(T0, minutes);

type Stores = ReturnType<typeof createMemoryStores>;

let counter = 0;

async function makeRepo(stores: Stores, slug = "acme/billing"): Promise<RepoRecord> {
  return stores.repos.ensure("PROJ", slug);
}

async function makeWorksite(
  stores: Stores,
  repo: RepoRecord,
  over: Partial<Worksite> = {},
): Promise<Worksite> {
  counter += 1;
  return stores.worksites.create({
    issueKey: `PROJ-${counter}`,
    repoId: repo.id,
    accountId: "lea@example.com",
    kind: "human",
    state: "open",
    openedAt: T0,
    lastActivityAt: T0,
    ...over,
  });
}

async function addFootprint(
  stores: Stores,
  w: Worksite,
  path: string,
  over: Partial<FootprintEntryInput> = {},
): Promise<void> {
  await stores.footprints.add([
    {
      worksiteId: w.id,
      path,
      kind: classifyPath(path),
      source: "declared",
      mode: "edit",
      at: T0,
      ...over,
    },
  ]);
}

function draft(over: Partial<CollisionDraft> = {}): CollisionDraft {
  return {
    repoId: "repo-1",
    worksiteA: "ws-1",
    worksiteB: "ws-2",
    path: "src/app.ts",
    degree: 2,
    rawDegree: 2,
    phase: "live",
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Repos and zones                                                     */
/* ------------------------------------------------------------------ */

describe("RepoStore / ZoneStore", () => {
  it("ensure is find-or-create and normalizes the slug", async () => {
    const stores = createMemoryStores();
    const repo = await stores.repos.ensure("PROJ", "/acme/billing/");
    expect(repo.slug).toBe("acme/billing");
    expect(repo.id).toMatch(/^repo-\d+$/);
    const again = await stores.repos.ensure("PROJ", "acme/billing");
    expect(again.id).toBe(repo.id);
    expect(await stores.repos.listByProject("PROJ")).toHaveLength(1);
    expect(await stores.repos.listByProject("OTHER")).toHaveLength(0);
  });

  it("ensure applies the zone catalog only at creation", async () => {
    const stores = createMemoryStores();
    const repo = await stores.repos.ensure("PROJ", "acme/billing");
    const zones = await stores.zones.listByRepo(repo.id);
    const names = zones.map((z) => z.name);
    expect(new Set(names).size).toBe(names.length);
    const again = await stores.repos.ensure("PROJ", "acme/billing");
    expect(await stores.zones.listByRepo(again.id)).toHaveLength(zones.length);
  });

  it("seedDefaults is idempotent and skips an existing zone name", async () => {
    const stores = createMemoryStores();
    const repo = await stores.repos.ensure("PROJ", "acme/billing");
    await stores.zones.upsert({
      id: "zone-migrations",
      repoId: repo.id,
      name: "migrations",
      patterns: ["**/migrations/**"],
      nature: "exclusive",
    });
    await stores.zones.seedDefaults(repo.id);
    await stores.zones.seedDefaults(repo.id);
    const names = (await stores.zones.listByRepo(repo.id)).map((z) => z.name);
    expect(names.filter((n) => n === "migrations")).toHaveLength(1);
  });

  it("zones can be upserted, read and removed", async () => {
    const stores = createMemoryStores();
    const zone = await stores.zones.upsert({
      id: "",
      repoId: "repo-x",
      name: "core",
      patterns: ["src/**"],
      nature: "hotspot",
    });
    expect(zone.id).toMatch(/^zone-\d+$/);
    expect((await stores.zones.findById(zone.id))?.name).toBe("core");
    expect(await stores.zones.remove(zone.id)).toBe(true);
    expect(await stores.zones.findById(zone.id)).toBeUndefined();
  });

  it("a seed provides repos and zones as given", async () => {
    const stores = createMemoryStores({
      repos: [
        {
          id: "repo-seed",
          projectId: "PROJ",
          provider: "github",
          slug: "acme/seed",
          defaultBranch: "main",
        },
      ],
      zones: [
        { id: "zone-seed", repoId: "repo-seed", name: "core", patterns: ["src/**"], nature: "hotspot" },
      ],
    });
    expect((await stores.repos.findBySlug("PROJ", "acme/seed"))?.id).toBe("repo-seed");
    expect(await stores.zones.listByRepo("repo-seed")).toHaveLength(1);
  });

  it("the stores never leak an internal reference", async () => {
    const stores = createMemoryStores();
    const repo = await stores.repos.ensure("PROJ", "acme/billing");
    repo.slug = "hacked";
    const stored = await stores.repos.findById(repo.id);
    expect(stored?.slug).toBe("acme/billing");
  });
});

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

describe("SessionStore", () => {
  it("touch creates then refreshes the session, keeping firstSeen and the id", async () => {
    const stores = createMemoryStores();
    const first = await stores.sessions.touch({
      accountId: "lea@example.com",
      kind: "agent",
      client: "claude-code",
      sessionRef: "s1",
      at: T0,
    });
    expect(first.id).toMatch(/^ses-\d+$/);
    expect(first.firstSeen).toBe(T0);
    const second = await stores.sessions.touch({
      accountId: "lea@example.com",
      kind: "agent",
      client: "claude-code",
      sessionRef: "s1",
      at: at(5),
    });
    expect(second.id).toBe(first.id);
    expect(second.firstSeen).toBe(T0);
    expect(second.lastSeen).toBe(at(5));
    expect(await stores.sessions.listByAccount("lea@example.com")).toHaveLength(1);
  });

  it("touch is keyed by account, client, session and agent", async () => {
    const stores = createMemoryStores();
    const base = {
      accountId: "lea@example.com",
      kind: "agent" as const,
      client: "claude-code",
      sessionRef: "s1",
    };
    const one = await stores.sessions.touch({ ...base, agentRef: "a1", at: T0 });
    const two = await stores.sessions.touch({ ...base, agentRef: "a2", at: T0 });
    const three = await stores.sessions.touch({ ...base, client: "mcp", agentRef: "a1", at: T0 });
    expect(new Set([one.id, two.id, three.id]).size).toBe(3);
    expect((await stores.sessions.findByRef("lea@example.com", "s1", "a2"))?.id).toBe(two.id);
  });
});

/* ------------------------------------------------------------------ */
/* Worksites                                                           */
/* ------------------------------------------------------------------ */

describe("WorksiteStore", () => {
  it("creates, reads and patches a worksite", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    expect(w.id).toMatch(/^ws-\d+$/);
    const updated = await stores.worksites.update(w.id, { state: "review", prOpen: true });
    expect(updated?.state).toBe("review");
    expect(updated?.prOpen).toBe(true);
    expect((await stores.worksites.findById(w.id))?.state).toBe("review");
    expect(await stores.worksites.update("ws-unknown", { state: "open" })).toBeUndefined();
  });

  it("findBySession returns the most recent non-closed worksite", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    await makeWorksite(stores, repo, { sessionId: "ses-1", openedAt: at(0) });
    const recent = await makeWorksite(stores, repo, { sessionId: "ses-1", openedAt: at(10) });
    await makeWorksite(stores, repo, { sessionId: "ses-1", openedAt: at(20), state: "closed" });
    const found = await stores.worksites.findBySession("ses-1");
    expect(found?.id).toBe(recent.id);
  });

  it("findByIssue excludes closed worksites and returns the newest first", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const older = await makeWorksite(stores, repo, { issueKey: "PROJ-9", openedAt: at(0) });
    const newer = await makeWorksite(stores, repo, { issueKey: "PROJ-9", openedAt: at(10) });
    await makeWorksite(stores, repo, { issueKey: "PROJ-9", openedAt: at(20), state: "closed" });
    const found = await stores.worksites.findByIssue("PROJ-9");
    expect(found.map((w) => w.id)).toEqual([newer.id, older.id]);
  });

  it("findByIssue filters by repo and by session", async () => {
    const stores = createMemoryStores();
    const repoA = await makeRepo(stores, "acme/a");
    const repoB = await makeRepo(stores, "acme/b");
    const a = await makeWorksite(stores, repoA, { issueKey: "PROJ-9", sessionId: "ses-1" });
    const b = await makeWorksite(stores, repoB, { issueKey: "PROJ-9", sessionId: "ses-2" });
    expect((await stores.worksites.findByIssue("PROJ-9", repoA.id)).map((w) => w.id)).toEqual([a.id]);
    expect(await stores.worksites.findByIssue("PROJ-9", repoA.id, "ses-2")).toHaveLength(0);
    expect((await stores.worksites.findByIssue("PROJ-9", undefined, "ses-2")).map((w) => w.id)).toEqual([
      b.id,
    ]);
  });

  it("listOpenByRepo lists the non-closed worksites of the repo", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const open = await makeWorksite(stores, repo);
    await makeWorksite(stores, repo, { state: "closed" });
    expect((await stores.worksites.listOpenByRepo(repo.id)).map((w) => w.id)).toEqual([open.id]);
  });

  it("listIdleBefore ignores dormant and closed worksites", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const idle = await makeWorksite(stores, repo, { lastActivityAt: at(-100) });
    await makeWorksite(stores, repo, { lastActivityAt: at(-100), state: "dormant" });
    await makeWorksite(stores, repo, { lastActivityAt: at(-100), state: "closed" });
    await makeWorksite(stores, repo, { lastActivityAt: T0 });
    expect((await stores.worksites.listIdleBefore(T0)).map((w) => w.id)).toEqual([idle.id]);
  });

  it("listDormantBefore returns the dormant worksites only", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const dormant = await makeWorksite(stores, repo, { lastActivityAt: at(-100), state: "dormant" });
    const recent = await makeWorksite(stores, repo, { lastActivityAt: at(-10), state: "dormant" });
    await makeWorksite(stores, repo, { lastActivityAt: at(-100), state: "open" });
    // both dormant worksites are idle before T0; the open one never matches
    expect((await stores.worksites.listDormantBefore(T0)).map((w) => w.id)).toEqual([
      dormant.id,
      recent.id,
    ]);
    // a tighter bound keeps only the long-dormant one
    expect((await stores.worksites.listDormantBefore(at(-50))).map((w) => w.id)).toEqual([
      dormant.id,
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Footprints                                                          */
/* ------------------------------------------------------------------ */

describe("FootprintStore", () => {
  it("add refreshes lastAt but keeps firstAt and one entry per path", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { at: T0 });
    const [entry] = await stores.footprints.add([
      { worksiteId: w.id, path: "src/app.ts", kind: "file", source: "declared", mode: "edit", at: at(30) },
    ]);
    expect(entry.firstAt).toBe(T0);
    expect(entry.lastAt).toBe(at(30));
    expect(await stores.footprints.listByWorksite(w.id)).toHaveLength(1);
  });

  it("add widens the source to the strongest one seen", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { source: "declared" });
    await addFootprint(stores, w, "src/app.ts", { source: "observed" });
    expect((await stores.footprints.listByWorksite(w.id))[0].source).toBe("observed");
    await addFootprint(stores, w, "src/app.ts", { source: "predicted" });
    expect((await stores.footprints.listByWorksite(w.id))[0].source).toBe("observed");
    await addFootprint(stores, w, "src/app.ts", { source: "attested" });
    expect((await stores.footprints.listByWorksite(w.id))[0].source).toBe("attested");
  });

  it("add widens the mode to the strongest one seen", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { mode: "edit" });
    await addFootprint(stores, w, "src/app.ts", { mode: "create" });
    expect((await stores.footprints.listByWorksite(w.id))[0].mode).toBe("create");
    await addFootprint(stores, w, "src/app.ts", { mode: "delete" });
    expect((await stores.footprints.listByWorksite(w.id))[0].mode).toBe("delete");
    await addFootprint(stores, w, "src/app.ts", { mode: "edit" });
    expect((await stores.footprints.listByWorksite(w.id))[0].mode).toBe("delete");
  });

  it("declaredMismatch stays flagged once observed", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { declaredMismatch: true });
    await addFootprint(stores, w, "src/app.ts", { declaredMismatch: false });
    expect((await stores.footprints.listByWorksite(w.id))[0].declaredMismatch).toBe(true);
  });

  it("coverage counts the entries per source", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { source: "declared" });
    await addFootprint(stores, w, "src/other.ts", { source: "declared" });
    await addFootprint(stores, w, "src/third.ts", { source: "attested" });
    expect(await stores.footprints.coverage(w.id)).toEqual({ declared: 2, attested: 1 });
  });

  it("removeByWorksite removes every entry, or only one source", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { source: "declared" });
    await addFootprint(stores, w, "src/other.ts", { source: "attested" });
    expect(await stores.footprints.removeByWorksite(w.id, "declared")).toBe(1);
    expect(await stores.footprints.listByWorksite(w.id)).toHaveLength(1);
    expect(await stores.footprints.removeByWorksite(w.id)).toBe(1);
    expect(await stores.footprints.listByWorksite(w.id)).toHaveLength(0);
  });

  it("findOverlapping matches the exact path, the parent dirs and the patterns", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts");
    await addFootprint(stores, w, "lib");
    await addFootprint(stores, w, "docs/**");
    const paths = async (path: string): Promise<string[]> =>
      (await stores.footprints.findOverlapping(repo.id, path)).map((e) => e.path);
    expect(await paths("src/app.ts")).toContain("src/app.ts");
    expect(await paths("lib")).toContain("lib");
    expect(await paths("lib/deep/file.ts")).toContain("lib");
    expect(await paths("docs/readme.md")).toContain("docs/**");
  });

  it("findOverlapping is scoped to the repo", async () => {
    const stores = createMemoryStores();
    const repoA = await makeRepo(stores, "acme/a");
    const repoB = await makeRepo(stores, "acme/b");
    const other = await makeWorksite(stores, repoB);
    await addFootprint(stores, other, "src/app.ts");
    expect(await stores.footprints.findOverlapping(repoA.id, "src/app.ts")).toHaveLength(0);
    expect(await stores.footprints.findOverlapping(repoB.id, "src/app.ts")).toHaveLength(1);
  });

  it("findOverlapping does not filter the closed worksites", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const closed = await makeWorksite(stores, repo, { state: "closed" });
    await addFootprint(stores, closed, "src/app.ts");
    expect(await stores.footprints.findOverlapping(repo.id, "src/app.ts")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Collisions                                                          */
/* ------------------------------------------------------------------ */

describe("CollisionStore", () => {
  it("upsert creates an open collision and keeps the first detectedAt", async () => {
    const stores = createMemoryStores();
    const first = await stores.collisions.upsert(draft({ detectedAt: T0 }));
    expect(first.state).toBe("open");
    expect(first.detectedAt).toBe(T0);
    expect(first.id).toMatch(/^col-\d+$/);
    const again = await stores.collisions.upsert(
      draft({ detectedAt: at(30), degree: 4, rawDegree: 4, path: "src/other.ts", phase: "pr" }),
    );
    expect(again.id).toBe(first.id);
    expect(again.detectedAt).toBe(T0);
    expect(again.degree).toBe(4);
    expect(again.rawDegree).toBe(4);
    expect(again.path).toBe("src/other.ts");
    expect(again.phase).toBe("pr");
  });

  it("upsert normalizes the pair and separates the zones", async () => {
    const stores = createMemoryStores();
    const forward = await stores.collisions.upsert(draft({ worksiteA: "ws-2", worksiteB: "ws-1" }));
    const backward = await stores.collisions.upsert(draft({ worksiteA: "ws-1", worksiteB: "ws-2" }));
    expect(backward.id).toBe(forward.id);
    expect(forward.worksiteA).toBe("ws-1");
    expect(forward.worksiteB).toBe("ws-2");
    const zoned = await stores.collisions.upsert(draft({ zoneId: "zone-1" }));
    expect(zoned.id).not.toBe(forward.id);
    expect(zoned.zoneId).toBe("zone-1");
  });

  it("lists by repo, by worksite and by ids, and resolves a collision", async () => {
    const stores = createMemoryStores();
    const c = await stores.collisions.upsert(draft());
    expect(await stores.collisions.listByRepo("repo-1")).toHaveLength(1);
    expect(await stores.collisions.listByRepo("repo-2")).toHaveLength(0);
    expect((await stores.collisions.listByWorksite("ws-2")).map((x) => x.id)).toEqual([c.id]);
    expect((await stores.collisions.listByIds([c.id, "col-unknown"])).map((x) => x.id)).toEqual([c.id]);
    const resolved = await stores.collisions.resolve(c.id, "wait", "lea@example.com", "migrations");
    expect(resolved?.state).toBe("resolved");
    expect(resolved?.resolution).toBe("wait");
    expect(resolved?.resolvedBy).toBe("lea@example.com");
    expect(await stores.collisions.listByRepo("repo-1", true)).toHaveLength(0);
  });

  it("countByPhase counts the open collisions per phase", async () => {
    const stores = createMemoryStores();
    await stores.collisions.upsert(draft({ phase: "before-code", detectedAt: T0 }));
    await stores.collisions.upsert(draft({ worksiteB: "ws-3", phase: "live", detectedAt: at(10) }));
    await stores.collisions.upsert(draft({ worksiteB: "ws-4", phase: "pr", detectedAt: at(20) }));
    expect(await stores.collisions.countByPhase("repo-1")).toEqual({
      "before-code": 1,
      live: 1,
      pr: 1,
    });
    expect(await stores.collisions.countByPhase("repo-1", at(15))).toEqual({
      "before-code": 0,
      live: 0,
      pr: 1,
    });
    expect(await stores.collisions.countByPhase("repo-2")).toEqual({
      "before-code": 0,
      live: 0,
      pr: 0,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

describe("ReservationStore", () => {
  it("listActive excludes the released and the expired reservations", async () => {
    const stores = createMemoryStores();
    const active = await stores.reservations.create({
      worksiteId: "ws-1",
      repoId: "repo-1",
      patterns: ["src/**"],
      hard: true,
      createdAt: T0,
      expiresAt: at(60),
    });
    await stores.reservations.create({
      worksiteId: "ws-2",
      repoId: "repo-1",
      patterns: ["lib/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(-10),
    });
    const released = await stores.reservations.create({
      worksiteId: "ws-3",
      repoId: "repo-1",
      patterns: ["docs/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
      releasedAt: at(5),
    });
    const list = await stores.reservations.listActive("repo-1", T0);
    expect(list.map((r) => r.id)).toEqual([active.id]);
    expect(released.id).toBeTruthy();
    expect(await stores.reservations.listByWorksite("ws-1", T0)).toHaveLength(1);
  });

  it("findActiveOverlapping matches the patterns and the plain paths", async () => {
    const stores = createMemoryStores();
    const glob = await stores.reservations.create({
      worksiteId: "ws-1",
      repoId: "repo-1",
      patterns: ["src/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
    });
    const dir = await stores.reservations.create({
      worksiteId: "ws-2",
      repoId: "repo-1",
      patterns: ["lib"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
    });
    await stores.reservations.create({
      worksiteId: "ws-3",
      repoId: "repo-1",
      patterns: ["docs/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
    });
    const hits = await stores.reservations.findActiveOverlapping("repo-1", ["src/app.ts"], T0);
    expect(hits.map((r) => r.id)).toEqual([glob.id]);
    const deep = await stores.reservations.findActiveOverlapping("repo-1", ["lib/deep/file.ts"], T0);
    expect(deep.map((r) => r.id)).toEqual([dir.id]);
    expect(await stores.reservations.findActiveOverlapping("repo-1", ["docs/readme.md"], T0)).toHaveLength(
      1,
    );
    expect(await stores.reservations.findActiveOverlapping("repo-2", ["src/app.ts"], T0)).toHaveLength(0);
  });

  it("release and releaseExpired free the reservations once", async () => {
    const stores = createMemoryStores();
    const r = await stores.reservations.create({
      worksiteId: "ws-1",
      repoId: "repo-1",
      patterns: ["src/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
    });
    expect(await stores.reservations.release(r.id, at(10))).toBe(true);
    expect(await stores.reservations.release("res-unknown", at(10))).toBe(false);
    expect((await stores.reservations.findById(r.id))?.releasedAt).toBe(at(10));
    const expired = await stores.reservations.create({
      worksiteId: "ws-2",
      repoId: "repo-1",
      patterns: ["lib/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(-10),
    });
    const released = await stores.reservations.releaseExpired(T0);
    expect(released.map((x) => x.id)).toEqual([expired.id]);
    expect(await stores.reservations.releaseExpired(T0)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

describe("NoticeStore", () => {
  it("post registers the recipients and pendingFor returns the views oldest first", async () => {
    const stores = createMemoryStores();
    const notice = await stores.notices.post(
      {
        worksiteId: "ws-1",
        repoId: "repo-1",
        authorAccountId: "lea@example.com",
        issueKey: "PROJ-1",
        paths: ["src/app.ts"],
        text: "je prends src/app.ts",
        createdAt: T0,
      },
      ["ws-2"],
    );
    expect(notice.id).toMatch(/^ntc-\d+$/);
    const pending = await stores.notices.pendingFor(["ws-2"]);
    expect(pending).toHaveLength(1);
    expect(pending[0].fromIssueKey).toBe("PROJ-1");
    expect(pending[0].fromActorLabel).toBe("lea@example.com");
    expect(pending[0].paths).toEqual(["src/app.ts"]);
    expect(await stores.notices.pendingFor(["ws-3"])).toHaveLength(0);
    expect(await stores.notices.listByWorksite("ws-1")).toHaveLength(1);
  });

  it("markDelivered delivers a notice once per worksite", async () => {
    const stores = createMemoryStores();
    const notice = await stores.notices.post(
      {
        worksiteId: "ws-1",
        repoId: "repo-1",
        authorAccountId: "lea@example.com",
        issueKey: "PROJ-1",
        paths: [],
        text: "attention",
        createdAt: T0,
      },
      ["ws-2", "ws-3"],
    );
    await stores.notices.markDelivered(notice.id, "ws-2", at(5));
    await stores.notices.markDelivered(notice.id, "ws-2", at(9));
    expect((await stores.notices.pendingFor(["ws-2"])).map((n) => n.noticeId)).not.toContain(notice.id);
    expect((await stores.notices.pendingFor(["ws-3"])).map((n) => n.noticeId)).toContain(notice.id);
  });
});

/* ------------------------------------------------------------------ */
/* Predictions, conflicts, tokens, events, rules                       */
/* ------------------------------------------------------------------ */

describe("PredictionStore", () => {
  it("save replaces the predictions of the same issue and repo", async () => {
    const stores = createMemoryStores();
    const prediction = {
      issueKey: "PROJ-1",
      repoId: "repo-1",
      entries: [{ path: "src/app.ts", kind: "file" as const, confidence: 0.7 }],
      confidence: 0.7,
      basis: { componentMatch: true, referenceTickets: [] },
      computedAt: T0,
    };
    await stores.predictions.save(prediction);
    await stores.predictions.save({ ...prediction, confidence: 0.9, computedAt: at(10) });
    const found = await stores.predictions.findByIssue("PROJ-1", "repo-1");
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe(0.9);
    expect(await stores.predictions.findByIssue("PROJ-1", "repo-2")).toHaveLength(0);
    expect(await stores.predictions.removeByIssue("PROJ-1")).toBe(1);
    expect(await stores.predictions.findByIssue("PROJ-1")).toHaveLength(0);
  });
});

describe("ConflictStore", () => {
  it("reports and lists the real conflicts", async () => {
    const stores = createMemoryStores();
    const conflict = await stores.conflicts.report({
      repoId: "repo-1",
      worksiteA: "ws-1",
      worksiteB: "ws-2",
      issueKeyA: "PROJ-1",
      issueKeyB: "PROJ-2",
      paths: ["src/app.ts"],
      wasDetected: true,
      reportedAt: T0,
    });
    expect(conflict.id).toMatch(/^cfl-\d+$/);
    expect(await stores.conflicts.list("repo-1")).toHaveLength(1);
    expect(await stores.conflicts.list("repo-2")).toHaveLength(0);
    expect(await stores.conflicts.list("repo-1", at(10))).toHaveLength(0);
  });
});

describe("TokenStore", () => {
  it("creates, finds, touches and revokes the hook tokens", async () => {
    const stores = createMemoryStores();
    const token = await stores.tokens.create({
      accountId: "lea@example.com",
      tokenHash: "abc123",
      scope: "personal",
      createdAt: T0,
    });
    expect((await stores.tokens.findByHash("abc123"))?.accountId).toBe("lea@example.com");
    await stores.tokens.touchLastUsed("abc123", at(5));
    expect((await stores.tokens.findByHash("abc123"))?.lastUsedAt).toBe(at(5));
    expect(await stores.tokens.listByAccount("lea@example.com")).toHaveLength(1);
    expect(await stores.tokens.revoke("abc123")).toBe(true);
    expect(await stores.tokens.findByHash("abc123")).toBeUndefined();
    expect(token.scope).toBe("personal");
  });
});

describe("EventStore", () => {
  it("appends events with an increasing seq", async () => {
    const stores = createMemoryStores();
    const first = await stores.events.append({ at: T0, kind: "declare", worksiteId: "ws-1" });
    const second = await stores.events.append({ at: at(5), kind: "touch", worksiteId: "ws-2" });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect((await stores.events.listByWorksite("ws-1")).map((e) => e.seq)).toEqual([1]);
    expect((await stores.events.recent(1)).map((e) => e.seq)).toEqual([2]);
  });
});

describe("RulesStore", () => {
  it("falls back to the default rules and stores the ones of the project", async () => {
    const stores = createMemoryStores();
    const defaults = await stores.rules.get("PROJ");
    expect(defaults).toEqual({ ...DEFAULT_PRIORITY_RULES, projectId: "PROJ" });
    const rules: PriorityRules = { ...defaults, order: ["incident", "first"], hardMode: true };
    await stores.rules.set(rules);
    const stored = await stores.rules.get("PROJ");
    expect(stored.hardMode).toBe(true);
    expect(stored.order).toEqual(["incident", "first"]);
    expect((await stores.rules.get("OTHER")).hardMode).toBe(false);
  });
});
