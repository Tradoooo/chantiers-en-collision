/**
 * site/demo/main.ts — the browser demo entry, bundled by esbuild into
 * site/dist/demo.js (global `Chantiers`). It runs the REAL engine (services
 * + core + in-memory stores) inside the page: no server, no Jira, no
 * network. Two features:
 *   - playground(A, B): two agents declare footprints, verdicts come back
 *   - fourAgents(): the spec's scenario, replayed step by step
 * Headless entry points are used by scripts/check-site-bundle.mjs (CI).
 */

import type { Ctx } from "../../src/services/ctx";
import type { Identity, SimulationResult, Verdict } from "../../src/core/types";
import { declareFootprint } from "../../src/services/declare";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import { runScenario } from "../../src/simulation/run";
import { FOUR_AGENTS } from "../../src/simulation/scenarios";
import { ACTORS, createWorld, WORLD, type DemoWorld } from "./world";
import { button, el, type SectionMount } from "./sections/types";
import { sweep } from "../../src/services/maintenance";
import { mountMap } from "./sections/map";
import { mountPlanning } from "./sections/planning";
import { mountPanel } from "./sections/panel";
import { mountOps } from "./sections/ops";

// Headless API for scripts/check-site-bundle.mjs (CI): the world is part of
// the contract too, so the CI gate can seed it and assert the demo story.
export { createWorld, WORLD };

const REPO = "acme/billing";

function ctxFor(stores: ReturnType<typeof createMemoryStores>, now: () => string, id: Identity): Ctx {
  return { stores, now, identity: id, projectId: "PROJ" } as Ctx;
}

export interface PlaygroundResult {
  a: Verdict;
  b: Verdict;
}

/** Agent A declares, then agent B declares; both verdicts are returned. */
export async function playground(pathsA: string, pathsB: string): Promise<PlaygroundResult> {
  const stores = createMemoryStores();
  const clock = makeClock();
  const now = () => clock.now();
  const lea = ctxFor(stores, now, {
    accountId: "lea@example.com", kind: "agent", client: "claude-code", sessionRef: "agent-lea",
  });
  const a = await declareFootprint(lea, {
    issueKey: "PROJ-88", repoSlug: REPO, paths: pathsA, session: "agent-lea",
  });
  clock.advance(4);
  const karim = ctxFor(stores, now, {
    accountId: "karim@example.com", kind: "agent", client: "claude-code", sessionRef: "agent-karim",
  });
  const b = await declareFootprint(karim, {
    issueKey: "PROJ-101", repoSlug: REPO, paths: pathsB, session: "agent-karim",
  });
  return { a, b };
}

/** Headless replay of the "four agents" scenario (used by CI too). */
export async function fourAgents(): Promise<SimulationResult> {
  return runScenario(FOUR_AGENTS);
}

/* ------------------------------------------------------------------ */
/* DOM wiring                                                          */
/* ------------------------------------------------------------------ */

const PRESETS: { label: string; a: string; b: string }[] = [
  { label: "Same file (D2)", a: "src/billing/invoice.ts", b: "src/billing/invoice.ts" },
  { label: "Folder vs file", a: "src/billing/", b: "src/billing/invoice.ts" },
  { label: "Migrations lock (D4)", a: "db/migrations/0042_total_cents.sql", b: "db/migrations/0043_index.sql" },
  { label: "Translations (hotspot)", a: "src/i18n/messages.json", b: "src/i18n/messages.json" },
  { label: "Lockfile (exclusive)", a: "package-lock.json", b: "package-lock.json" },
  { label: "No collision", a: "src/billing/invoice.ts", b: "src/auth/login.ts" },
];

function verdictCard(title: string, verdict: Verdict): HTMLElement {
  const card = el("div", `card verdict verdict-${verdict.kind}`);
  card.appendChild(el("h3", undefined, title));
  const kind = el("span", `chip chip-${verdict.kind}`, verdict.kind.toUpperCase());
  card.appendChild(kind);
  for (const c of verdict.collisions) {
    const line = el(
      "div",
      "collision-line",
      `D${c.degree} · ${c.path} · ${c.neighbor.issueKey} (${c.neighbor.actorLabel})`,
    );
    card.appendChild(line);
  }
  const pre = el("pre", "verdict-text");
  pre.textContent = verdict.text;
  card.appendChild(pre);
  return card;
}

async function runPlayground(): Promise<void> {
  const pathsA = (document.getElementById("paths-a") as HTMLTextAreaElement).value;
  const pathsB = (document.getElementById("paths-b") as HTMLTextAreaElement).value;
  const out = document.getElementById("playground-out");
  if (!out) return;
  out.textContent = "computing…";
  try {
    const res = await playground(pathsA, pathsB);
    out.replaceChildren(verdictCard("PROJ-88 · agent of Léa", res.a), verdictCard("PROJ-101 · agent of Karim", res.b));
  } catch (e) {
    out.textContent = `error: ${(e as Error).message}`;
  }
}

function stepCard(index: number, r: SimulationResult["results"][number]): HTMLElement {
  const card = el("div", `card step ${r.ok ? "step-ok" : "step-ko"}`);
  const head = el("div", "step-head");
  head.appendChild(el("span", "step-n", String(index)));
  head.appendChild(el("span", "step-actor", r.step.actor));
  head.appendChild(el("span", "chip", r.step.action));
  head.appendChild(el("span", r.ok ? "step-flag-ok" : "step-flag-ko", r.ok ? "✓" : "✗"));
  card.appendChild(head);
  if (r.step.note) card.appendChild(el("p", "step-note", r.step.note));
  if (r.detail) {
    const pre = el("pre", "verdict-text");
    pre.textContent = r.detail;
    card.appendChild(pre);
  }
  return card;
}

async function runFourAgents(): Promise<void> {
  const out = document.getElementById("scenario-out");
  if (!out) return;
  out.textContent = "replaying…";
  try {
    const res = await fourAgents();
    out.replaceChildren(...res.results.map((r, i) => stepCard(i + 1, r)));
    const badge = el("div", res.allOk ? "scenario-ok" : "scenario-ko");
    badge.textContent = res.allOk
      ? "Scenario complete — every expectation met."
      : "Scenario finished with mismatches.";
    out.prepend(badge);
  } catch (e) {
    out.textContent = `error: ${(e as Error).message}`;
  }
}

/* ------------------------------------------------------------------ */
/* The shared demo world: clock bar, actors, sections                  */
/* ------------------------------------------------------------------ */

async function advanceAndSweep(world: DemoWorld, minutes: number): Promise<void> {
  world.advance(minutes);
  await sweep(world.ctx("dev")); // dormancy, auto-close, reservation expiry
  world.touch();
}

function hardModeToggle(world: DemoWorld): HTMLElement {
  const label = el("label", "world-hard");
  const box = el("input") as HTMLInputElement;
  box.type = "checkbox";
  void world.stores.rules.get("PROJ").then((r) => {
    box.checked = r.hardMode;
  });
  box.addEventListener("change", () => {
    void world.stores.rules.get("PROJ").then(async (r) => {
      await world.stores.rules.set({ ...r, hardMode: box.checked });
      world.touch();
    });
  });
  label.appendChild(box);
  label.appendChild(el("span", undefined, " hard mode (the hook denies)"));
  return label;
}

function worldBar(world: DemoWorld): HTMLElement {
  const bar = el("div", "world-bar");
  bar.appendChild(
    el("div", "world-clock", `Demo clock — ${world.clock.now().replace("T", " ").slice(0, 16)} UTC`),
  );
  const actors = el("div", "world-actors");
  for (const a of ACTORS) actors.appendChild(el("span", "chip", a.displayName));
  bar.appendChild(actors);
  const controls = el("div", "world-controls");
  controls.appendChild(button("+5 min", () => void advanceAndSweep(world, 5)));
  controls.appendChild(button("+25 h → dormancy", () => void advanceAndSweep(world, 25 * 60)));
  controls.appendChild(button("+8 d → auto-close", () => void advanceAndSweep(world, 8 * 24 * 60)));
  controls.appendChild(hardModeToggle(world));
  controls.appendChild(button("Reset the demo", () => void world.reset(), "btn ghost small"));
  bar.appendChild(controls);
  bar.appendChild(
    el(
      "p",
      "world-hint",
      "One shared in-memory world (repo acme/billing, seeded sprint): every section below reads and mutates it through the real services.",
    ),
  );
  return bar;
}

function mountAll(world: DemoWorld): void {
  const mounts: [string, SectionMount][] = [
    ["mount-world", (root, w) => root.appendChild(worldBar(w))],
    ["mount-map", mountMap],
    ["mount-planning", mountPlanning],
    ["mount-panel", mountPanel],
    ["mount-ops", mountOps],
  ];
  for (const [id, mount] of mounts) {
    const root = document.getElementById(id);
    if (root) mount(root, world);
  }
}

async function boot(): Promise<void> {
  await WORLD.seed();
  mountAll(WORLD);
  WORLD.subscribe(() => mountAll(WORLD));
}

/** Public aggregate proof of life of the deployed app (see /proof route). */
const PROOF_URL =
  "https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ/proof";

interface ProofPayload {
  ok: boolean;
  generatedAt: string;
  repositories: number;
  worksites: number;
  collisions: number;
  reservations: number;
  events: number;
  lastEvent: string | null;
}

function renderProof(target: HTMLElement, payload: ProofPayload): void {
  target.replaceChildren();
  const head = el("div", "proof-head");
  head.appendChild(el("span", "proof-dot", ""));
  head.appendChild(el("strong", undefined, "deployment alive"));
  head.appendChild(el("span", "muted small", ` · ${payload.generatedAt}`));
  target.appendChild(head);
  const grid = el("div", "proof-grid");
  const figures: [string, string | number][] = [
    ["repositories", payload.repositories],
    ["open worksites", payload.worksites],
    ["open collisions", payload.collisions],
    ["active reservations", payload.reservations],
    ["events (10 last)", payload.events],
  ];
  for (const [label, value] of figures) {
    const cell = el("div", "proof-cell");
    cell.appendChild(el("div", "proof-value", String(value)));
    cell.appendChild(el("div", "proof-label", label));
    grid.appendChild(cell);
  }
  target.appendChild(grid);
  if (payload.lastEvent) {
    target.appendChild(el("div", "muted small", `last event: ${payload.lastEvent}`));
  }
}

async function pollProof(): Promise<void> {
  const target = document.getElementById("live-proof");
  if (!target) return;
  try {
    const res = await fetch(PROOF_URL, { headers: { Accept: "application/json" } });
    const payload = (await res.json()) as ProofPayload;
    if (payload.ok === true) {
      renderProof(target, payload);
      return;
    }
  } catch {
    // offline — keep the last reading
  }
  target.replaceChildren(
    el("div", "proof-head"),
    el("span", "muted", "deployment unreachable right now (the site still runs the same engine locally)"),
  );
}

function init(): void {
  const declareBtn = document.getElementById("btn-declare");
  declareBtn?.addEventListener("click", () => void runPlayground());
  const presetBar = document.getElementById("presets");
  for (const preset of PRESETS) {
    const btn = el("button", "preset");
    btn.type = "button";
    btn.textContent = preset.label;
    btn.addEventListener("click", () => {
      (document.getElementById("paths-a") as HTMLTextAreaElement).value = preset.a;
      (document.getElementById("paths-b") as HTMLTextAreaElement).value = preset.b;
      void runPlayground();
    });
    presetBar?.appendChild(btn);
  }
  const scenarioBtn = document.getElementById("btn-scenario");
  scenarioBtn?.addEventListener("click", () => void runFourAgents());
  void runFourAgents();
  void boot();
  void pollProof();
  window.setInterval(() => void pollProof(), 30000);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
