/**
 * core/footprints — footprint entry building, merging and coverage (spec §5).
 * Owner: workstream D.
 *
 * Spec §5: a footprint is made of files, folders and patterns; the fact beats
 * the intent (observed/attested entries widen the declared footprint and the
 * gap is noted), and every entry keeps its own source so the panel can show
 * what is supposed / announced / proven.
 */

import type {
  FootprintCoverage,
  FootprintEntry,
  FootprintEntryInput,
  FootprintMode,
  FootprintSource,
} from "./types";
import { classifyPath, entriesOverlap, normalizePath } from "./paths";

/** predicted < declared < observed < attested: a fact beats an intent. */
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

/** Sources that are facts, not intentions (spec §5: "le fait l'emporte"). */
function isFact(source: FootprintSource): boolean {
  return source === "observed" || source === "attested";
}

function strongestSource(a: FootprintSource, b: FootprintSource): FootprintSource {
  return SOURCE_RANK[b] > SOURCE_RANK[a] ? b : a;
}

function strongestMode(a: FootprintMode, b: FootprintMode): FootprintMode {
  return MODE_RANK[b] > MODE_RANK[a] ? b : a;
}

function entryKey(entry: { worksiteId: string; path: string }): string {
  return `${entry.worksiteId}\u0000${entry.path}`;
}

/**
 * Parse a paths block (one path per line, "#" comments and blank lines
 * ignored) into footprint entry inputs. Uses normalizePath + classifyPath.
 * One entry per distinct normalized path (first occurrence wins).
 */
export function entriesFromPaths(
  paths: string,
  worksiteId: string,
  source: FootprintSource,
  mode: FootprintMode,
  at: string,
): FootprintEntryInput[] {
  const seen = new Set<string>();
  const out: FootprintEntryInput[] = [];
  for (const rawLine of paths.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const path = normalizePath(line);
    if (path === "" || seen.has(path)) continue;
    seen.add(path);
    out.push({ worksiteId, path, kind: classifyPath(path), source, mode, at });
  }
  return out;
}

/** An entry to add, carrying the timestamps it must keep in the store. */
export type MergeAdd = FootprintEntryInput & { firstAt?: string; lastAt?: string };

export interface MergeResult {
  /** Entries to add/refresh in the store. */
  toAdd: MergeAdd[];
  /** Observed/attested paths outside the declared footprint — the gap. */
  mismatches: string[];
}

/** Same path twice inside one batch: last one wins, strongest facts merged. */
function combineInputs(prev: FootprintEntryInput, next: FootprintEntryInput): FootprintEntryInput {
  const combined: FootprintEntryInput = {
    ...next,
    source: strongestSource(prev.source, next.source),
    mode: strongestMode(prev.mode, next.mode),
    at: next.at ?? prev.at,
  };
  if (prev.declaredMismatch || next.declaredMismatch) combined.declaredMismatch = true;
  return combined;
}

/** Collapse duplicates of the incoming batch, keeping the last, merged. */
function dedupeIncoming(incoming: FootprintEntryInput[]): FootprintEntryInput[] {
  const byKey = new Map<string, FootprintEntryInput>();
  for (const input of incoming) {
    const key = entryKey(input);
    const prev = byKey.get(key);
    byKey.set(key, prev ? combineInputs(prev, input) : { ...input });
  }
  return [...byKey.values()];
}

function freshEntry(input: FootprintEntryInput, at: string, mismatch: boolean): MergeAdd {
  const entry: MergeAdd = { ...input, at, firstAt: at, lastAt: at };
  if (mismatch) entry.declaredMismatch = true;
  return entry;
}

function refreshedEntry(
  prev: FootprintEntry,
  input: FootprintEntryInput,
  at: string,
  mismatch: boolean,
): MergeAdd {
  const entry: MergeAdd = {
    worksiteId: input.worksiteId,
    path: input.path,
    kind: input.kind,
    source: strongestSource(prev.source, input.source),
    mode: strongestMode(prev.mode, input.mode),
    at,
    firstAt: prev.firstAt,
    lastAt: at,
  };
  if (prev.declaredMismatch || mismatch) entry.declaredMismatch = true;
  return entry;
}

/** Is this path already covered by a declared entry of that worksite? */
function coveredByDeclaration(
  declared: FootprintEntry[],
  input: FootprintEntryInput,
): boolean {
  return declared.some(
    (entry) =>
      entry.worksiteId === input.worksiteId &&
      entriesOverlap(entry.path, entry.kind, input.path, input.kind),
  );
}

/**
 * "The fact beats the intent": when a fact source (observed/attested) arrives
 * outside the declared entries, the footprint widens and the gap is noted in
 * `mismatches` (and the entry gets declaredMismatch = true).
 * Same path twice → strongest source wins (attested > observed > declared >
 * predicted); most destructive mode wins (rename/delete > create > edit).
 * An entry already known keeps its firstAt and gets lastAt = `at`.
 */
export function mergeEntries(
  existing: FootprintEntry[],
  incoming: FootprintEntryInput[],
  at: string,
): MergeResult {
  const knownByKey = new Map<string, FootprintEntry>();
  for (const entry of existing) knownByKey.set(entryKey(entry), entry);
  const declared = existing.filter((entry) => entry.source === "declared");

  const mismatches: string[] = [];
  const toAdd: MergeAdd[] = [];
  for (const input of dedupeIncoming(incoming)) {
    const mismatch = isFact(input.source) && !coveredByDeclaration(declared, input);
    if (mismatch && !mismatches.includes(input.path)) mismatches.push(input.path);
    const prev = knownByKey.get(entryKey(input));
    toAdd.push(prev ? refreshedEntry(prev, input, at, mismatch) : freshEntry(input, at, mismatch));
  }
  return { toAdd, mismatches };
}

/** Count of entries per source — the panel shows supposed/announced/proven. */
export function coverageOf(entries: FootprintEntry[]): FootprintCoverage {
  const coverage: FootprintCoverage = {};
  for (const entry of entries) {
    coverage[entry.source] = (coverage[entry.source] ?? 0) + 1;
  }
  return coverage;
}
