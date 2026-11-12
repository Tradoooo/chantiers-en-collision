// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, type DemoWorld } from "../../site/demo/world";
import { mountMap } from "../../site/demo/sections/map";

let world: DemoWorld;
let root: HTMLElement;

beforeEach(async () => {
  world = createWorld();
  await world.seed();
  root = document.createElement("div");
  document.body.replaceChildren(root);
  mountMap(root, world);
});

describe("map section", () => {
  it("renders the seeded footprints in the tree", async () => {
    await vi.waitFor(() => {
      expect(root.textContent).toContain("db/migrations/0101_renumber.sql".split("/").pop());
      expect(root.textContent).toContain("PROJ-93");
      expect(root.textContent).toContain("PROJ-88");
    });
  });

  it("colours the exclusive-migrations collision on the map", async () => {
    // The seeded pair PROJ-93 × PROJ-95 shares the exclusive zone: the
    // collisions store gets its rows on the next detection — declare once to
    // materialise them, then re-mount.
    const { declareFootprint } = await import("../../src/services/declare.js");
    await declareFootprint(world.ctx("a4"), {
      issueKey: "PROJ-95",
      repoSlug: world.repoSlug,
      paths: "db/migrations/0102_index.sql",
      session: "a4",
    });
    mountMap(root, world);
    await vi.waitFor(() => expect(root.textContent).toContain("D4"));
  });

  it("lists the zone catalog with natures", async () => {
    await vi.waitFor(() => {
      expect(root.textContent).toContain("migrations (exclusive)");
      expect(root.textContent).toContain("lockfiles (exclusive)");
      expect(root.textContent).toContain("billing (ordinary)");
    });
  });

  it("shows the parallel width of the repo", async () => {
    await vi.waitFor(() => expect(root.textContent).toContain("Parallel width"));
    await vi.waitFor(() =>
      expect(root.textContent).toMatch(/supports \d+ agent/),
    );
  });

  it("who-touches answers for a seeded path", async () => {
    await vi.waitFor(() => expect(root.textContent).toContain("Who touches"));
    // The default input value targets the seeded invoice worksite.
    await vi.waitFor(() => expect(root.textContent).toContain("PROJ-88"));
  });
});
