/**
 * Section: worksite map, zones, who-touches and parallel width.
 * Renders the shared demo world through the REAL services (no server).
 * Owner: orchestrator. Mounted by site/demo/main.ts, re-mounted on every
 * world change (world.touch / clock moves / reset).
 */

import { normalizePath, parentDirs } from "../../../src/core/paths";
import { zoneForPath } from "../../../src/core/zones";
import { minutesBetween } from "../../../src/testing/clock";
import { buildNeighborInfo, loadOpenWorksites } from "../../../src/services/shared";
import { measureParallelWidth } from "../../../src/services/width";
import { whoTouches } from "../../../src/services/worksites";
import type { DemoWorld } from "../world";
import { button, card, degreeChip, el, type SectionMount } from "./types";

interface MapRow {
  path: string;
  depth: number;
  isDir: boolean;
  zoneName?: string;
  zoneNature?: string;
  worstDegree?: number;
  occupants: { issueKey: string; label: string; state: string; lastActivityAt: string }[];
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function touchRow(map: Map<string, MapRow>, path: string, isDir: boolean): MapRow {
  let row = map.get(path);
  if (!row) {
    row = { path, depth: path.split("/").length - 1, isDir, occupants: [] };
    map.set(path, row);
  }
  return row;
}

/** The repository tree built from the open worksites' footprints. */
async function buildRows(world: DemoWorld): Promise<MapRow[]> {
  const repoId = world.repoId();
  const zones = await world.stores.zones.listByRepo(repoId);
  const open = await loadOpenWorksites(world.ctx("dev"), repoId);
  const collisions = await world.stores.collisions.listByRepo(repoId, true);
  const map = new Map<string, MapRow>();

  for (const side of open) {
    const info = await buildNeighborInfo(world.ctx("dev"), side.worksite, "en");
    for (const entry of side.entries) {
      const p = normalizePath(entry.path);
      for (const dir of parentDirs(p)) touchRow(map, dir, true);
      const row = touchRow(map, p, entry.kind === "dir");
      row.occupants.push({
        issueKey: side.worksite.issueKey,
        label: info.actorLabel,
        state: side.worksite.state,
        lastActivityAt: side.worksite.lastActivityAt,
      });
    }
  }
  for (const c of collisions) {
    const p = normalizePath(c.path);
    const row = map.get(p) ?? touchRow(map, p, false);
    if (row.worstDegree === undefined || c.degree > row.worstDegree) {
      row.worstDegree = c.degree;
    }
  }
  for (const row of map.values()) {
    const zone = zoneForPath(zones, row.path);
    if (zone) {
      row.zoneName = zone.name;
      row.zoneNature = zone.nature;
    }
  }
  return [...map.values()].sort(compareRows);
}

function compareRows(a: MapRow, b: MapRow): number {
  const as = a.path.split("/");
  const bs = b.path.split("/");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xDir = i === as.length - 1 ? a.isDir : true;
    const yDir = i === bs.length - 1 ? b.isDir : true;
    if (xDir !== yDir) return xDir ? -1 : 1;
    if (x !== y) return x.localeCompare(y);
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function treeLine(row: MapRow, now: string): HTMLElement {
  const line = el("div", row.occupants.length > 0 ? "occ" : "free");
  line.style.paddingLeft = `${row.depth * 18}px`;
  const label = `${row.depth > 0 ? "└─ " : ""}${row.path.split("/").pop() ?? row.path}${row.isDir ? "/" : ""}`;
  line.appendChild(el("span", undefined, label));
  line.appendChild(el("span", undefined, " "));
  line.appendChild(degreeChip(row.worstDegree));
  if (row.zoneName) {
    line.appendChild(el("span", "chip", `${row.zoneName} · ${row.zoneNature ?? ""}`));
  }
  for (const o of row.occupants) {
    const ago = minutesBetween(o.lastActivityAt, now);
    line.appendChild(el("span", "chip chip-caution", `${o.issueKey} · ${o.label} · ${o.state} · ${ago} min ago`));
  }
  return line;
}

async function renderTree(body: HTMLElement, world: DemoWorld): Promise<void> {
  const rows = await buildRows(world);
  const now = world.clock.now();
  body.replaceChildren(...rows.map((r) => treeLine(r, now)));
}

function whoTouchesCard(world: DemoWorld): HTMLElement {
  const out = el("div", "stack");
  const input = el("input") as HTMLInputElement;
  input.className = "sel";
  input.style.width = "100%";
  input.value = "src/billing/invoice.ts";
  const run = async () => {
    out.replaceChildren(el("p", "muted", "looking…"));
    try {
      const found = await whoTouches(world.ctx("dev"), {
        repoSlug: world.repoSlug,
        path: input.value,
      });
      if (found.length === 0) {
        out.replaceChildren(el("p", undefined, "Nobody on this ground right now."));
        return;
      }
      const now = world.clock.now();
      out.replaceChildren(
        ...found.map((n) =>
          el(
            "p",
            undefined,
            `${n.issueKey} · ${n.actorLabel} · ${n.state} · active ${minutesBetween(n.lastActivityAt, now)} min ago`,
          ),
        ),
      );
    } catch (e) {
      out.replaceChildren(el("p", "ko", `error: ${(e as Error).message}`));
    }
  };
  const controls = el("div", "row-flex");
  controls.appendChild(input);
  controls.appendChild(button("Who touches?", () => void run()));
  const c = card("Who touches this path?", controls, out);
  void run();
  return c;
}

async function renderWidth(body: HTMLElement, world: DemoWorld): Promise<void> {
  try {
    const w = await measureParallelWidth(world.ctx("dev"), { repoSlug: world.repoSlug });
    const lines: HTMLElement[] = [
      el("p", undefined, `This repo currently supports ${w.width} agent(s) at once over ${w.ticketCount} worksite(s) — confidence ${w.confidence}.`),
    ];
    for (const b of w.bottlenecks) {
      lines.push(el("p", "muted", `bottleneck: ${b.label} (${b.edges} collision link(s))`));
    }
    if (w.suggestion) {
      lines.push(
        el("p", "ok", `${w.suggestion.split} → ${w.suggestion.widthAfter} at once (+${w.suggestion.delta}).`),
      );
    }
    if (w.note) lines.push(el("p", "muted", w.note));
    body.replaceChildren(...lines);
  } catch (e) {
    body.replaceChildren(el("p", "ko", `error: ${(e as Error).message}`));
  }
}

async function renderZones(body: HTMLElement, world: DemoWorld): Promise<void> {
  const zones = await world.stores.zones.listByRepo(world.repoId());
  const table = el("table", "kv");
  for (const z of zones) {
    const tr = el("tr");
    tr.appendChild(el("td", "kv-k", `${z.name} (${z.nature})`));
    tr.appendChild(el("td", "kv-v", z.patterns.join("  ")));
    table.appendChild(tr);
  }
  body.replaceChildren(table);
}

export const mountMap: SectionMount = (root, world) => {
  root.replaceChildren();
  const grid = el("div", "section-grid");

  const treeBody = el("div", "tree");
  grid.appendChild(card("Worksite map — who is where, right now", treeBody));

  const right = el("div", "stack");
  const widthBody = el("div");
  right.appendChild(card("Parallel width (spec §27)", widthBody));
  right.appendChild(whoTouchesCard(world));
  grid.appendChild(right);

  const zonesBody = el("div");
  grid.appendChild(card("Zones of acme/billing (default catalog + team zones)", zonesBody));

  root.appendChild(grid);
  void renderTree(treeBody, world);
  void renderWidth(widthBody, world);
  void renderZones(zonesBody, world);
};
