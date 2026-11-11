/**
 * core/footprints — footprint entry building, merging and coverage (spec §5).
 * Owner: workstream D. Replace each stub; keep signatures EXACTLY.
 */

import type {
  FootprintCoverage,
  FootprintEntry,
  FootprintEntryInput,
  FootprintMode,
  FootprintSource,
} from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

/**
 * Parse a paths block (one path per line, "#" comments and blank lines
 * ignored) into footprint entry inputs. Uses normalizePath + classifyPath.
 */
export function entriesFromPaths(
  _paths: string,
  _worksiteId: string,
  _source: FootprintSource,
  _mode: FootprintMode,
  _at: string,
): FootprintEntryInput[] {
  throw TODO("footprints");
}

export interface MergeResult {
  /** Entries to add/refresh in the store. */
  toAdd: FootprintEntryInput[];
  /** Observed/attested paths outside the declared footprint — the gap. */
  mismatches: string[];
}

/**
 * "The fact beats the intent": when a fact source (observed/attested) arrives
 * outside the declared entries, the footprint widens and the gap is noted in
 * `mismatches` (and the entry gets declaredMismatch = true).
 * Same path twice → strongest source wins (attested > observed > declared >
 * predicted); most destructive mode wins (rename/delete > create > edit).
 */
export function mergeEntries(
  _existing: FootprintEntry[],
  _incoming: FootprintEntryInput[],
  _at: string,
): MergeResult {
  throw TODO("footprints");
}

/** Count of entries per source — the panel shows supposed/announced/proven. */
export function coverageOf(_entries: FootprintEntry[]): FootprintCoverage {
  throw TODO("footprints");
}
