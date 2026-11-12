// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, type DemoWorld } from "../../site/demo/world";
import { mountOps } from "../../site/demo/sections/ops";

let world: DemoWorld;
let root: HTMLElement;

function clickByText(text: string): void {
  const btn = [...root.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  expect(btn, `button "${text}" not found`).toBeDefined();
  btn!.click();
}

function logs(): string {
  return [...root.querySelectorAll(".log")]
    .map((l) => l.textContent ?? "")
    .join("\n");
}

beforeEach(async () => {
  world = createWorld();
  await world.seed();
  root = document.createElement("div");
  document.body.replaceChildren(root);
  mountOps(root, world);
});

describe("ops section — hook simulator (§9.3)", () => {
  it("opens a session, then a touch on a contested file warns with the neighbour", async () => {
    clickByText("SessionStart → /open");
    await vi.waitFor(() => expect(logs()).toContain("session opened"));
    clickByText("PreToolUse → /touch");
    await vi.waitFor(() => expect(logs()).toContain("PROJ-88"));
    expect(logs()).toContain("invoice.ts");
  });

  it("records the touched path as an observed footprint", async () => {
    clickByText("SessionStart → /open");
    await vi.waitFor(() => {
      const open = world.stores.worksites.findByIssue("PROJ-101", world.repoId());
      return expect(open).resolves.toBeDefined();
    });
    clickByText("PreToolUse → /touch");
    await vi.waitFor(async () => {
      const ws = (await world.stores.worksites.findByIssue("PROJ-101", world.repoId()))[0]!;
      const entries = await world.stores.footprints.listByWorksite(ws.id);
      expect(entries.some((e) => e.source === "observed" && e.path === "src/billing/invoice.ts")).toBe(true);
    });
  });
});

describe("ops section — CI push (§10)", () => {
  it("attests the branch footprint, then a main push merges and closes", async () => {
    clickByText("Send CI footprint");
    await vi.waitFor(() => expect(logs()).toContain("2 file(s) attested"));
    clickByText("Push to main (merge)");
    await vi.waitFor(() => expect(logs()).toContain("outcome merged"));
    const open = await world.stores.worksites.findByIssue("PROJ-120", world.repoId());
    expect(open).toHaveLength(0); // closed worksites are not listed
  });
});

describe("ops section — lifecycle (§11)", () => {
  it("the sweep sends idle worksites to dormancy", async () => {
    world.advance(25 * 60);
    clickByText("Run the sweep now");
    await vi.waitFor(() => expect(logs()).toContain('"dormant"'));
    const open = await world.stores.worksites.listOpenByRepo(world.repoId());
    expect(open.filter((w) => w.state === "dormant").length).toBeGreaterThan(0);
  });
});

describe("ops section — learning loop (§13)", () => {
  it("reports the four numbers, the accuracy and the legacy-db proposal", async () => {
    clickByText("Run the learning report");
    await vi.waitFor(() => expect(root.textContent).toContain("missed until merge"));
    await vi.waitFor(() => expect(root.textContent).toContain("src/legacy-db/**"));
    expect(root.textContent).toContain("exclusive");
    expect(root.textContent).toContain("Prediction accuracy: 50 %");
  });
});

describe("ops section — tokens (§17)", () => {
  it("generates a personal token shown once", async () => {
    clickByText("Generate a personal token");
    await vi.waitFor(() => expect(logs()).toContain("shown ONCE"));
    const stored = await world.stores.tokens.listByAccount("dev@example.com");
    expect(stored).toHaveLength(1);
    expect(logs()).not.toContain(stored[0]!.tokenHash.slice(12));
  });
});
