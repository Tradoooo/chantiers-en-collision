// Footprints and collisions (split 2/3 of the memory store suite).
import { describe, expect, it } from "vitest";
import { T0, at, makeRepo, makeWorksite, addFootprint, draft } from "./helpers";
import { createMemoryStores } from "../../src/storage/memory";

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
