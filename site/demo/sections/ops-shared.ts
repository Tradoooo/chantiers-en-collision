/**
 * Shared helpers for the operations section (site/demo/sections/ops-*.ts).
 * Kept local to the ops workstream: types.ts only exposes the generic card /
 * input helpers, and the ops blocks need a header data-table, a log box, and a
 * browser-safe token context (the esbuild bundle stubs node:crypto, so the real
 * createToken fallback would throw in the page — we inject demo randomHex +
 * sha256 instead; the fingerprint shown is a demo digest, not cryptographic).
 */

import type { Ctx } from "../../../src/services/ctx";
import type { DemoWorld } from "../world";
import { minutesBetween } from "../../../src/testing/clock";
import { el } from "./types";

/* ------------------------------------------------------------------ */
/* Data table (header row + body rows), like the planning section's    */
/* ------------------------------------------------------------------ */

const TABLE_CSS = "width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;";
const TH_CSS = "text-align:left;padding:4px 8px;border-bottom:1px solid #30363d;font-size:12px;";
const TD_CSS = "padding:4px 8px;border-bottom:1px solid #21262d;vertical-align:top;";

export function dataTable(
  headers: string[],
  rows: (string | HTMLElement)[][],
): HTMLElement {
  const table = el("table");
  table.style.cssText = TABLE_CSS;
  const head = el("tr");
  for (const h of headers) {
    const th = el("th", "muted", h);
    th.style.cssText = TH_CSS;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const row of rows) {
    const tr = el("tr");
    for (const cell of row) {
      const td = el("td");
      td.style.cssText = TD_CSS;
      if (typeof cell === "string") td.textContent = cell;
      else td.appendChild(cell);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}

/* ------------------------------------------------------------------ */
/* Log box (.log) — a preformatted panel the blocks write into         */
/* ------------------------------------------------------------------ */

/** A fresh .log box with a placeholder line. */
export function logBox(placeholder = "(nothing yet)"): HTMLElement {
  return el("pre", "log", placeholder);
}

/** Replace a .log box's content (keeps the same node so refs stay valid). */
export function setLog(box: HTMLElement, text: string): void {
  box.textContent = text;
}

/** Append a line to a .log box (keeps prior lines, newest last). */
export function appendLog(box: HTMLElement, line: string): void {
  const prev = box.textContent ?? "";
  box.textContent = prev === "" || prev === "(nothing yet)" ? line : `${prev}\n${line}`;
}

/* ------------------------------------------------------------------ */
/* "X min ago" from an ISO timestamp against the demo clock            */
/* ------------------------------------------------------------------ */

export function agoText(iso: string, now: string): string {
  const mins = minutesBetween(iso, now);
  return `${mins} min ago`;
}

/* ------------------------------------------------------------------ */
/* Browser-safe token context                                          */
/* ------------------------------------------------------------------ */

const HEX = "0123456789abcdef";

/** Demo randomness (node:crypto is stubbed in the browser bundle). */
export function demoRandomHex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes * 2; i += 1) out += HEX[Math.floor(Math.random() * 16)];
  return out;
}

/**
 * Demo digest: a deterministic 32-hex fingerprint (xmur3-style mixing). NOT
 * cryptographic — it only has to be stable and unique enough to display a
 * 12-char token fingerprint in the page without touching node:crypto.
 */
export function demoSha256(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h1 >>> 0).toString(16).padStart(8, "0");
  const lo = (h2 >>> 0).toString(16).padStart(8, "0");
  return (hi + lo + hi.split("").reverse().join("") + lo.split("").reverse().join("")).slice(0, 32);
}

/** A Ctx for one actor, with demo randomHex + sha256 injected (tokens work). */
export function tokenCtx(world: DemoWorld, actorRef: string): Ctx {
  return { ...world.ctx(actorRef), randomHex: demoRandomHex, sha256: demoSha256 };
}
