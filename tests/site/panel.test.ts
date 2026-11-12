// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, type DemoWorld } from "../../site/demo/world";
import { mountPanel } from "../../site/demo/sections/panel";

let world: DemoWorld;
let root: HTMLElement;

function clickByText(text: string): void {
  const btn = [...root.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  expect(btn, `button "${text}" not found`).toBeDefined();
  btn!.click();
}

async function picker(): Promise<HTMLSelectElement> {
  return vi.waitFor(() => {
    const p = root.querySelector('[data-testid="ticket-picker"]') as HTMLSelectElement | null;
    expect(p).not.toBeNull();
    return p!;
  });
}

async function selectTicket(key: string): Promise<void> {
  const p = await picker();
  p.value = key;
  p.dispatchEvent(new Event("change"));
}

beforeEach(async () => {
  world = createWorld();
  await world.seed();
  root = document.createElement("div");
  document.body.replaceChildren(root);
  mountPanel(root, world);
});

describe("panel section", () => {
  it("lists the seeded tickets in the picker", async () => {
    const p = await picker();
    const options = [...p.options].map((o) => o.value);
    expect(options).toContain("PROJ-88");
    expect(options).toContain("PROJ-93");
    expect(options).toContain("PROJ-95");
  });

  it("shows the footprint and the reservation of PROJ-93", async () => {
    await selectTicket("PROJ-93");
    await vi.waitFor(() =>
      expect(root.textContent).toContain("db/migrations/0101_renumber.sql"),
    );
    expect(root.textContent).toContain("declared");
    expect(root.textContent).toContain("Reservations");
  });

  it("shows the D4 collision of PROJ-95 with its six outcomes", async () => {
    await selectTicket("PROJ-95");
    await vi.waitFor(() => expect(root.textContent).toContain("D4"));
    for (const choice of ["wait", "sequence", "coordinate", "split", "merge", "override"]) {
      expect(root.textContent).toContain(choice);
    }
  });

  it("coordinate sends a notice the neighbour can pick up", async () => {
    await selectTicket("PROJ-95");
    await vi.waitFor(() => expect(root.textContent).toContain("D4"));
    clickByText("coordinate");
    await vi.waitFor(() => expect(root.textContent).toContain("noticeSent"));
    const target = (await world.stores.worksites.findByIssue("PROJ-95"))[0]!;
    const pending = await world.stores.notices.pendingFor([target.id]);
    expect(pending.some((n) => n.text.includes("coordinate"))).toBe(true);
  });

  it("closing a worksite removes it from the picker", async () => {
    await selectTicket("PROJ-97");
    await vi.waitFor(() => expect(root.textContent).toContain("src/auth/login.ts"));
    clickByText("Close worksite");
    await vi.waitFor(async () => {
      const open = await world.stores.worksites.listOpenByRepo(world.repoId());
      expect(open.some((w) => w.issueKey === "PROJ-97")).toBe(false);
    });
  });
});
