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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

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
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
