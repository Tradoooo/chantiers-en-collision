/**
 * core/waves — plan-parallel-work (spec §9.5).
 * Owner: workstream C.
 *
 * A wave is a set of tickets an orchestrator can hand to N agents at once:
 * no two linked tickets inside one wave. Hinges (the most linked tickets)
 * open the plan, alone and first, so their wide footprint lands before the
 * rest.
 */

import { entriesOverlap, matchesGlob, normalizePath, pathContains } from "./paths";
import type { PathKind, PlanTicket, WavePlan, Zone } from "./types";
import { zoneForPath } from "./zones";

export interface PlanOptions {
  zones: Zone[];
  /** Max waves before giving up (default 50). */
  maxWaves?: number;
}

const DEFAULT_MAX_WAVES = 50;
const WORST = Number.POSITIVE_INFINITY;

/* ------------------------------------------------------------------ */
/* Footprint resolution                                                */
/* ------------------------------------------------------------------ */

interface ResolvedEntry {
  path: string;
  kind: PathKind;
  zone?: Zone;
}

/** A path living in an out-of-scope zone is ignored entirely (spec §6). */
function isOutOfScope(zones: Zone[], path: string): boolean {
  return zones.some(
    (zone) => zone.nature === "out-of-scope" && zone.patterns.some((p) => matchesGlob(p, path)),
  );
}

/**
 * Resolve each entry to its zone. `zoneForPath` already answers `undefined`
 * for out-of-scope winners, so the second test only catches paths that match
 * no zone at all but still land in an out-of-scope pattern.
 */
function resolveEntries(ticket: PlanTicket, zones: Zone[]): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  for (const entry of ticket.entries) {
    const path = normalizePath(entry.path);
    if (path === "") continue;
    const zone = zoneForPath(zones, path);
    if (!zone && isOutOfScope(zones, path)) continue;
    out.push({ path, kind: entry.kind, zone });
  }
  return out;
}

function isExclusiveResource(zone?: Zone): boolean {
  return zone !== undefined && (zone.nature === "exclusive" || zone.nature === "frozen");
}

function isHotspot(zone?: Zone): boolean {
  return zone?.nature === "hotspot";
}

/** Same file, or a file sitting directly under the other side's dir. */
function isSharpOverlap(x: ResolvedEntry, y: ResolvedEntry): boolean {
  if (x.path === y.path) return true;
  if (x.kind === "file" && y.kind === "dir" && pathContains(y.path, x.path)) return true;
  if (y.kind === "file" && x.kind === "dir" && pathContains(x.path, y.path)) return true;
  return false;
}

/** Both entries sit in the same exclusive (or frozen) resource. */
function sameExclusiveZone(x: ResolvedEntry, y: ResolvedEntry): boolean {
  if (!isExclusiveResource(x.zone) || !isExclusiveResource(y.zone)) return false;
  return x.zone?.id === y.zone?.id;
}

/** The most telling path for a pair: the shared file when there is one. */
function overlapPath(x: ResolvedEntry, y: ResolvedEntry): string {
  if (x.path === y.path) return x.path;
  if (x.kind === "dir" && y.kind !== "dir") return y.path;
  return x.path;
}

interface PairVerdict {
  kind: "link" | "watch";
  path: string;
}

/**
 * Collision degree of a pair of tickets, approximated from their entries:
 *  - a link = a shared exclusive resource (both sides in the same exclusive
 *    or frozen zone — "one migration at a time", even on different files),
 *    or an overlap at D2+ (same file, or a file inside the other side's dir)
 *    outside any hotspot;
 *  - a watch = the only overlap goes through a hotspot zone (translations
 *    file, routes): overlap expected, worth a look, not a blocker.
 */
function analysePair(a: ResolvedEntry[], b: ResolvedEntry[]): PairVerdict | undefined {
  for (const x of a) {
    for (const y of b) {
      if (!sameExclusiveZone(x, y)) continue;
      const shared = entriesOverlap(x.path, x.kind, y.path, y.kind) ? overlapPath(x, y) : x.path;
      return { kind: "link", path: shared };
    }
  }

  let watch: PairVerdict | undefined;
  for (const x of a) {
    for (const y of b) {
      if (!entriesOverlap(x.path, x.kind, y.path, y.kind)) continue;
      const hotspot = isHotspot(x.zone) || isHotspot(y.zone);
      if (!hotspot && isSharpOverlap(x, y)) return { kind: "link", path: overlapPath(x, y) };
      if (hotspot && watch === undefined) watch = { kind: "watch", path: overlapPath(x, y) };
    }
  }
  return watch;
}

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

type Graph = Map<string, Set<string>>;

function buildGraph(
  tickets: PlanTicket[],
  zones: Zone[],
): { graph: Graph; watchPairs: WavePlan["watchPairs"] } {
  const resolved = new Map<string, ResolvedEntry[]>();
  for (const ticket of tickets) resolved.set(ticket.issueKey, resolveEntries(ticket, zones));
  const graph: Graph = new Map();
  for (const ticket of tickets) if (!graph.has(ticket.issueKey)) graph.set(ticket.issueKey, new Set());
  const watchPairs: WavePlan["watchPairs"] = [];

  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const keyA = tickets[i]!.issueKey;
      const keyB = tickets[j]!.issueKey;
      if (keyA === keyB) continue;
      const verdict = analysePair(resolved.get(keyA) ?? [], resolved.get(keyB) ?? []);
      if (!verdict) continue;
      if (verdict.kind === "link") {
        graph.get(keyA)?.add(keyB);
        graph.get(keyB)?.add(keyA);
      } else {
        watchPairs.push({ a: keyA, b: keyB, why: `same hotspot file ${verdict.path}` });
      }
    }
  }
  return { graph, watchPairs };
}

/* ------------------------------------------------------------------ */
/* Ordering and hinges                                                 */
/* ------------------------------------------------------------------ */

function timeOf(iso?: string): number {
  if (!iso) return WORST;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? WORST : ms;
}

interface SortKeys {
  rank: Map<string, number>;
  due: Map<string, number>;
}

function sortKeysOf(tickets: PlanTicket[]): SortKeys {
  const rank = new Map<string, number>();
  const due = new Map<string, number>();
  for (const ticket of tickets) {
    rank.set(ticket.issueKey, ticket.priorityRank ?? WORST);
    due.set(ticket.issueKey, timeOf(ticket.dueAt));
  }
  return { rank, due };
}

/** Higher ticket priority first, nearest due date next, then a stable key. */
function byPriority(keys: SortKeys) {
  return (x: string, y: string): number => {
    const rx = keys.rank.get(x) ?? WORST;
    const ry = keys.rank.get(y) ?? WORST;
    if (rx !== ry) return rx < ry ? -1 : 1;
    const dx = keys.due.get(x) ?? WORST;
    const dy = keys.due.get(y) ?? WORST;
    if (dx !== dy) return dx < dy ? -1 : 1;
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

function degreeOf(graph: Graph, key: string): number {
  return graph.get(key)?.size ?? 0;
}

/**
 * Hinges = the most linked tickets (degree >= 2), highest degree first, then
 * by priority. A candidate already linked to a chosen hinge is left out: two
 * linked tickets never share a wave, hinges included.
 */
function pickHinges(tickets: PlanTicket[], graph: Graph): string[] {
  let maxDegree = 0;
  for (const key of graph.keys()) maxDegree = Math.max(maxDegree, degreeOf(graph, key));
  if (maxDegree < 2) return [];

  const keys = sortKeysOf(tickets);
  const candidates = [...graph.keys()]
    .filter((key) => degreeOf(graph, key) === maxDegree)
    .sort(byPriority(keys));

  const hinges: string[] = [];
  for (const key of candidates) {
    if (hinges.some((chosen) => graph.get(chosen)?.has(key))) continue;
    hinges.push(key);
  }
  return hinges;
}

/* ------------------------------------------------------------------ */
/* Packing                                                             */
/* ------------------------------------------------------------------ */

function canJoin(wave: string[], key: string, graph: Graph, size: number): boolean {
  if (wave.length >= size) return false;
  const links = graph.get(key);
  if (!links) return true;
  return !wave.some((member) => links.has(member));
}

/** First wave with room and no linked member; else a new one (capped). */
function placeTicket(
  key: string,
  waves: string[][],
  graph: Graph,
  size: number,
  cap: number,
  offset: number,
): void {
  for (let i = offset; i < waves.length; i++) {
    const wave = waves[i]!;
    if (canJoin(wave, key, graph, size)) {
      wave.push(key);
      return;
    }
  }
  if (waves.length < cap || waves.length === 0) {
    waves.push([key]);
    return;
  }
  // Cap reached: keep the ticket in the plan rather than silently dropping it.
  waves[waves.length - 1]!.push(key);
}

/* ------------------------------------------------------------------ */
/* Confidence                                                          */
/* ------------------------------------------------------------------ */

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A plan is only as good as the footprints behind it (spec §12). */
function confidenceOf(tickets: PlanTicket[]): Pick<WavePlan, "confidence" | "confidenceNote"> {
  const total = tickets.length;
  if (total === 0) return { confidence: "high" };
  const noComponent = tickets.filter((t) => t.components.length === 0).length;
  const noFootprint = tickets.filter((t) => t.entries.length === 0).length;
  const bare = tickets.filter((t) => t.components.length === 0 || t.entries.length === 0).length;
  const ratio = bare / total;
  const confidence = ratio > 0.5 ? "low" : ratio > 0.25 ? "medium" : "high";
  if (confidence === "high") return { confidence };
  const parts: string[] = [];
  if (noComponent > 0) {
    parts.push(plural(noComponent, "ticket without a component", "tickets without a component"));
  }
  if (noFootprint > 0) {
    parts.push(plural(noFootprint, "ticket without a footprint", "tickets without a footprint"));
  }
  return { confidence, confidenceNote: parts.join(" and ") };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Split tickets into collision-free waves:
 *  1. build a graph linking tickets colliding at D2+ OR sharing an exclusive
 *     resource (entriesOverlap + zoneForPath from core/paths and core/zones);
 *  2. hinge tickets = highest graph degree (ties → higher ticket priority);
 *     they go ALONE in wave 0, first;
 *  3. remaining tickets are packed by priority into waves of at most
 *     `workers` tickets, never two linked tickets in the same wave;
 *  4. watchPairs = pairs overlapping only through a hotspot zone (same
 *     translations file etc.) — overlap expected, worth a look;
 *  5. confidence: low when most tickets lack components or footprints,
 *     medium when some do, high otherwise (confidenceNote explains).
 */
export function planWaves(tickets: PlanTicket[], workers: number, opts: PlanOptions): WavePlan {
  const zones = opts.zones ?? [];
  const cap = Math.max(1, Math.floor(opts.maxWaves ?? DEFAULT_MAX_WAVES));
  const size = Math.max(1, Math.floor(Number.isFinite(workers) && workers >= 1 ? workers : 1));

  const { graph, watchPairs } = buildGraph(tickets, zones);
  const hinges = pickHinges(tickets, graph);
  const waves: string[][] = hinges.length > 0 ? [hinges] : [];
  const offset = hinges.length > 0 ? 1 : 0;
  const hingeSet = new Set(hinges);

  const ordered = tickets
    .map((ticket) => ticket.issueKey)
    .sort(byPriority(sortKeysOf(tickets)));
  for (const key of ordered) {
    if (hingeSet.has(key)) continue;
    placeTicket(key, waves, graph, size, cap, offset);
  }

  return { waves, hinges, watchPairs, ...confidenceOf(tickets) };
}
