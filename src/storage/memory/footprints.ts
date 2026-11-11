/**
 * storage/memory/footprints — FootprintStore.
 *
 * Entries are keyed by (worksiteId, path): re-adding the same path refreshes
 * `lastAt`, keeps `firstAt` and widens source/mode to the strongest seen
 * (spec §5). `findOverlapping` is the (repo, path) index of spec §18: the
 * comparison itself is `core/paths.entriesOverlap`, the repo scoping is a
 * join with the worksites. Closed worksites are NOT filtered here — services
 * do it through WorksiteStore.
 */

import type {
  FootprintCoverage,
  FootprintEntry,
  FootprintEntryInput,
  FootprintMode,
  FootprintSource,
  PathKind,
} from "../../core/types";
import { classifyPath, entriesOverlap } from "../../core/paths";
import type { FootprintStore } from "../interfaces";
import { clone } from "./clone";
import type { MemoryData } from "./state";
import { nowIso } from "./util";

/** predicted < declared < observed < attested (spec §5). */
const SOURCE_RANK: Record<FootprintSource, number> = {
  predicted: 0,
  declared: 1,
  observed: 2,
  attested: 3,
};

/** edit < create < delete/rename: a destructive intent is never downgraded. */
const MODE_RANK: Record<FootprintMode, number> = {
  edit: 0,
  create: 1,
  delete: 2,
  rename: 2,
};

function footprintKey(worksiteId: string, path: string): string {
  return `${worksiteId}\u0000${path}`;
}

function strongest<T extends string>(rank: Record<T, number>, current: T, incoming: T): T {
  return rank[incoming] > rank[current] ? incoming : current;
}

function fromInput(input: FootprintEntryInput, at: string): FootprintEntry {
  const entry: FootprintEntry = {
    worksiteId: input.worksiteId,
    path: input.path,
    kind: input.kind,
    source: input.source,
    mode: input.mode,
    firstAt: at,
    lastAt: at,
  };
  if (input.declaredMismatch) entry.declaredMismatch = true;
  return entry;
}

function merged(existing: FootprintEntry, input: FootprintEntryInput, at: string): FootprintEntry {
  const entry: FootprintEntry = {
    ...existing,
    source: strongest(SOURCE_RANK, existing.source, input.source),
    mode: strongest(MODE_RANK, existing.mode, input.mode),
    lastAt: at > existing.lastAt ? at : existing.lastAt,
  };
  if (existing.declaredMismatch || input.declaredMismatch) entry.declaredMismatch = true;
  return entry;
}

function repoOfWorksite(data: MemoryData, worksiteId: string): string | undefined {
  return data.worksites.get(worksiteId)?.repoId;
}

async function addFootprints(
  data: MemoryData,
  entries: FootprintEntryInput[],
): Promise<FootprintEntry[]> {
  const out = new Map<string, FootprintEntry>();
  for (const input of entries) {
    const key = footprintKey(input.worksiteId, input.path);
    const at = input.at ?? nowIso();
    const known = data.footprints.get(key);
    const stored = known ? merged(known, input, at) : fromInput(input, at);
    data.footprints.set(key, stored);
    out.set(key, stored);
  }
  return [...out.values()].map((entry) => clone(entry));
}

async function listFootprintsByWorksite(
  data: MemoryData,
  worksiteId: string,
): Promise<FootprintEntry[]> {
  const out: FootprintEntry[] = [];
  for (const entry of data.footprints.values()) {
    if (entry.worksiteId === worksiteId) out.push(clone(entry));
  }
  return out;
}

async function findOverlappingFootprints(
  data: MemoryData,
  repoId: string,
  path: string,
  kind?: PathKind,
): Promise<FootprintEntry[]> {
  const wanted = kind ?? classifyPath(path);
  const out: FootprintEntry[] = [];
  for (const entry of data.footprints.values()) {
    if (repoOfWorksite(data, entry.worksiteId) !== repoId) continue;
    if (!entriesOverlap(entry.path, entry.kind, path, wanted)) continue;
    out.push(clone(entry));
  }
  return out;
}

async function removeFootprintsByWorksite(
  data: MemoryData,
  worksiteId: string,
  source?: FootprintSource,
): Promise<number> {
  let removed = 0;
  for (const [key, entry] of [...data.footprints.entries()]) {
    if (entry.worksiteId !== worksiteId) continue;
    if (source !== undefined && entry.source !== source) continue;
    data.footprints.delete(key);
    removed += 1;
  }
  return removed;
}

async function footprintCoverage(data: MemoryData, worksiteId: string): Promise<FootprintCoverage> {
  const out: FootprintCoverage = {};
  for (const entry of data.footprints.values()) {
    if (entry.worksiteId !== worksiteId) continue;
    out[entry.source] = (out[entry.source] ?? 0) + 1;
  }
  return out;
}

export function createFootprintStore(data: MemoryData): FootprintStore {
  return {
    add: (entries) => addFootprints(data, entries),
    listByWorksite: (worksiteId) => listFootprintsByWorksite(data, worksiteId),
    findOverlapping: (repoId, path, kind) => findOverlappingFootprints(data, repoId, path, kind),
    removeByWorksite: (worksiteId, source) =>
      removeFootprintsByWorksite(data, worksiteId, source),
    coverage: (worksiteId) => footprintCoverage(data, worksiteId),
  };
}
