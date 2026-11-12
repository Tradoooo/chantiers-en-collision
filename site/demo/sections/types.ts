/**
 * Contract between the demo page and its feature sections.
 * A section mounts into its own container, renders the CURRENT state of the
 * shared world, and may mutate the world through the real services.
 */

import type { DemoWorld } from "../world";

/**
 * Mount (or re-mount) a section.
 * Rules:
 *  - clear `root` first (the page re-mounts sections on every world change:
 *    clock moves, reset, or another section mutating the shared state);
 *  - synchronous skeleton first, async data appended when ready;
 *  - after mutating the world, call `world.touch()` so every section
 *    re-renders consistently;
 *  - no imports from @forge/* (browser bundle), no network.
 */
export type SectionMount = (root: HTMLElement, world: DemoWorld) => void;

/** Small shared helpers for sections (kept here to avoid duplication). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A titled card (uses the site's .card style). */
export function card(title: string, ...children: (Node | string)[]): HTMLElement {
  const c = el("div", "card");
  c.appendChild(el("h3", undefined, title));
  for (const child of children) {
    c.appendChild(typeof child === "string" ? el("p", undefined, child) : child);
  }
  return c;
}

/** Simple two-column key/value table. */
export function kvTable(rows: [string, string | number | undefined][]): HTMLElement {
  const table = el("table", "kv");
  for (const [k, v] of rows) {
    const tr = el("tr");
    tr.appendChild(el("td", "kv-k", k));
    tr.appendChild(el("td", "kv-v", v === undefined ? "—" : String(v)));
    table.appendChild(tr);
  }
  return table;
}

export function button(label: string, onClick: () => void, cls = "btn small"): HTMLButtonElement {
  const b = el("button", cls);
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

export function select(
  options: { value: string; label: string }[],
  onChange: (value: string) => void,
  cls = "sel",
): HTMLSelectElement {
  const s = el("select", cls) as HTMLSelectElement;
  for (const o of options) {
    const opt = el("option");
    opt.value = o.value;
    opt.textContent = o.label;
    s.appendChild(opt);
  }
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

export function textarea(rows: number, value: string, cls = "ta"): HTMLTextAreaElement {
  const t = el("textarea", cls) as HTMLTextAreaElement;
  t.rows = rows;
  t.value = value;
  t.spellcheck = false;
  return t;
}

/** Verdict-kind chip with the site's colour classes. */
export function verdictChip(kind: string): HTMLElement {
  return el("span", `chip chip-${kind}`, kind.toUpperCase());
}

/** Degree chip (D0..D5) coloured like the map legend. */
export function degreeChip(degree: number | undefined): HTMLElement {
  if (degree === undefined) return el("span", "chip", "—");
  const cls = degree >= 4 ? "chip-stop" : degree === 3 ? "chip-wait" : degree >= 1 ? "chip-caution" : "chip-free";
  return el("span", `chip ${cls}`, `D${degree}`);
}
