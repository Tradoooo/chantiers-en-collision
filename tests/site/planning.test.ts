// @vitest-environment jsdom
/**
 * Tests of the planning section of the public site demo: the REAL engine
 * (services/planning + core) runs in jsdom against the shared demo world
 * (in-memory stores, Jira stub). See site/demo/sections/planning.ts for the
 * curated footprint and the expected plan graph.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, type DemoWorld } from "../../site/demo/world";
import { ensurePredictions, mountPlanning } from "../../site/demo/sections/planning";
import { nextClearTicket } from "../../src/services/planning";

const JQL = "sprint = 42";

function findButton(root: HTMLElement, label: string): HTMLButtonElement {
  const btn = [...root.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(btn, `button "${label}" missing`).toBeDefined();
  return btn as HTMLButtonElement;
}

let world: DemoWorld;
let root: HTMLElement;

beforeEach(async () => {
  world = createWorld();
  await world.seed();
  root = document.createElement("div");
  document.body.replaceChildren(root);
  mountPlanning(root, world);
});

describe("planning section", () => {
  it("(a) seeds the predictions of the sprint tickets on mount", async () => {
    await vi.waitFor(async () => {
      const stored = await world.stores.predictions.findByIssue("PROJ-93", world.repoId());
      expect(stored.length).toBeGreaterThan(0);
    });
    // Idempotent: seeding again never duplicates (upsert by issueKey+repoId).
    await ensurePredictions(world);
    const stored = await world.stores.predictions.findByIssue("PROJ-93", world.repoId());
    expect(stored).toHaveLength(1);
    expect(stored[0]?.entries.map((e) => e.path)).toEqual(["db/migrations/0101_renumber.sql"]);
  });

  it("(b) plans at least two waves and highlights a hinge", async () => {
    findButton(root, "Plan the sprint").click();
    await vi.waitFor(() => {
      const text = root.textContent ?? "";
      expect((text.match(/Wave/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect(text).toContain("hinge");
    });
    // Verified graph: PROJ-101 is the hinge (invoice.ts + exclusive migrations).
    expect(root.textContent).toContain("PROJ-101 (hinge)");
  });

  it("(c) sprint check lists at least one risky pair", async () => {
    findButton(root, "Check the sprint").click();
    await vi.waitFor(() => {
      const text = root.textContent ?? "";
      expect(text).toContain("PROJ-88");
      expect(text).toContain("PROJ-90");
    });
    // Risky pairs (D2+) render their degree chip and the shared path.
    expect(root.textContent).toContain("src/billing/invoice.ts");
    expect(root.querySelectorAll(".chip").length).toBeGreaterThan(0);
  });

  it("(d) dispatcher answers with a clear ticket and offers the button", async () => {
    findButton(root, "Next clear ticket"); // the control exists in the skeleton
    await ensurePredictions(world);
    const next = await nextClearTicket(world.ctx("a1"), { jql: JQL, session: "a1" });
    expect(next.issueKey).toBeTruthy();
    // Only PROJ-105 (i18n) collides with nobody once predictions are seeded.
    expect(next.issueKey).toBe("PROJ-105");
    expect(next.why).toBeTruthy();
  });

  it("(e) Start it opens one more worksite", async () => {
    findButton(root, "Next clear ticket").click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain("PROJ-105");
    });
    const before = (await world.stores.worksites.listOpenByRepo(world.repoId())).length;
    findButton(root, "Start it").click();
    await vi.waitFor(async () => {
      const after = await world.stores.worksites.listOpenByRepo(world.repoId());
      expect(after.length).toBe(before + 1);
    });
    const open = await world.stores.worksites.listOpenByRepo(world.repoId());
    expect(open.some((w) => w.issueKey === "PROJ-105")).toBe(true);
  });
});
