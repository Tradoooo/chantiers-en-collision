// Repos/zones, sessions, worksites (split 1/3 of the memory store suite).
import { describe, expect, it } from "vitest";
import { T0, at, makeRepo, makeWorksite } from "./helpers";
import { createMemoryStores } from "../../src/storage/memory";

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
