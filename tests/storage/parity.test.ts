/**
 * Parity contract of the two stores (spec §18, CONTRACTS "one collision per
 * (pair, zone)").
 *
 * The app runs on Forge SQL (src/storage/forge) in production and on the
 * in-memory store (src/storage/memory) in the tests, in the site bundle and in
 * the simulation console. Both MUST honour the rules below — otherwise a
 * judge reads a verdict the tests never saw.
 *
 * These tests pin the rules on the store that runs locally; the Forge side
 * is held to the same rules by the static guard (scripts/check-storage.mjs).
 */
import { describe, expect, it } from "vitest";
import { T0, at, makeRepo, makeWorksite, addFootprint, draft } from "./helpers";
import { createMemoryStores } from "../../src/storage/memory";

describe("store parity — footprints", () => {
  it("widens the source to the strongest one (the fact beats the intent)", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { source: "declared" });
    await addFootprint(stores, w, "src/app.ts", { source: "observed" });
    await addFootprint(stores, w, "src/app.ts", { source: "attested" });
    await addFootprint(stores, w, "src/app.ts", { source: "predicted" });
    const [entry] = await stores.footprints.listByWorksite(w.id);
    expect(entry.source).toBe("attested");
  });

  it("treats delete and rename as equally destructive (same rank)", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { mode: "delete" });
    await addFootprint(stores, w, "src/app.ts", { mode: "rename" });
    const [entry] = await stores.footprints.listByWorksite(w.id);
    // Same rank → the first one stays (no upgrade, no downgrade).
    expect(entry.mode).toBe("delete");
  });

  it("keeps firstAt = first observation, even when a later add carries an older clock", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts", { at: at(10) });
    await addFootprint(stores, w, "src/app.ts", { at: at(5) });
    const [entry] = await stores.footprints.listByWorksite(w.id);
    expect(entry.firstAt).toBe(at(10));
    expect(entry.lastAt).toBe(at(10));
  });

  it("keeps one entry per (worksite, path) — the key the schema enforces", async () => {
    const stores = createMemoryStores();
    const repo = await makeRepo(stores);
    const w = await makeWorksite(stores, repo);
    await addFootprint(stores, w, "src/app.ts");
    await addFootprint(stores, w, "src/app.ts", { source: "observed" });
    const entries = await stores.footprints.listByWorksite(w.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("observed");
  });
});

describe("store parity — collisions", () => {
  it("keeps the id and the first detectedAt on re-detection", async () => {
    const stores = createMemoryStores();
    const created = await stores.collisions.upsert(draft({ detectedAt: at(1) }));
    const again = await stores.collisions.upsert(draft({ detectedAt: at(30), degree: 3 }));
    expect(again.id).toBe(created.id);
    expect(again.detectedAt).toBe(at(1));
    expect(again.degree).toBe(3);
  });

  it("preserves a recorded resolution and reason when the next resolve omits them", async () => {
    const stores = createMemoryStores();
    const created = await stores.collisions.upsert(draft({ detectedAt: T0 }));
    await stores.collisions.resolve(created.id, "split", "lea@example.com", "split the file");
    const again = await stores.collisions.resolve(created.id, undefined, "lea@example.com", undefined);
    expect(again?.state).toBe("resolved");
    expect(again?.resolution).toBe("split");
    expect(again?.reason).toBe("split the file");
  });

  it("keeps the resolution when the collision is detected again", async () => {
    const stores = createMemoryStores();
    const created = await stores.collisions.upsert(draft({ detectedAt: T0 }));
    await stores.collisions.resolve(created.id, "wait", "lea@example.com", "waiting");
    const again = await stores.collisions.upsert(draft({ detectedAt: at(30), degree: 4 }));
    expect(again.resolution).toBe("wait");
    expect(again.reason).toBe("waiting");
  });

  it("keeps one collision per (pair, zone)", async () => {
    const stores = createMemoryStores();
    const first = await stores.collisions.upsert(draft({ detectedAt: T0 }));
    const second = await stores.collisions.upsert(draft({ detectedAt: at(30) }));
    expect(second.id).toBe(first.id);
    const all = await stores.collisions.listByRepo("repo-1");
    expect(all).toHaveLength(1);
  });
});
