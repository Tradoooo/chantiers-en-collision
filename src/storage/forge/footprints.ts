/**
 * storage/forge/footprints — FootprintStore over Forge SQL.
 * Owner: workstream E.
 *
 * Semantics (src/storage/interfaces.ts):
 *  - `add` upserts on (worksiteId, path): lastAt refreshed, firstAt kept,
 *    source and mode WIDENED (strongest evidence / most destructive mode),
 *    declaredMismatch sticky once noted;
 *  - `findOverlapping` is scoped by repoId and served by the (repo_id, path)
 *    index: exact path + each parent dir + everything below the path, plus a
 *    BOUNDED scan of the repo's `pattern` entries (globs cannot be matched in
 *    SQL). Candidates are then filtered in JS through core/paths.entriesOverlap;
 *  - closed worksites are NOT filtered here — the services do it.
 *
 * `repo_id` is denormalized onto each footprint row (resolved from the
 * worksite) so the overlap query never needs a join (spec §18).
 */

import { classifyPath, entriesOverlap, parentDirs } from "../../core/paths";
import { strongestMode, strongestSource } from "../../core/footprints";
import type {
  FootprintCoverage,
  FootprintEntry,
  FootprintEntryInput,
  FootprintMode,
  FootprintSource,
  PathKind,
} from "../../core/types";
import type { FootprintStore } from "../interfaces";
import { all, allText, bool, likePrefix, newId, one, run, runText, str } from "./db";
import type { SqlScalar } from "./db";
import { repoIdsOfWorksites } from "./worksites";

/** Upper bound of rows scanned by one overlap query (Forge SQL: 5 s/SELECT). */
const OVERLAP_SCAN_LIMIT = 2000;
/** Upper bound of `pattern` entries considered per repo. */
const PATTERN_SCAN_LIMIT = 500;

interface FootprintRow {
  id: string;
  worksite_id: string;
  repo_id: string;
  path: string;
  kind: string;
  source: string;
  mode: string;
  first_at: string;
  last_at: string;
  declared_mismatch: number;
}

function toEntry(row: FootprintRow): FootprintEntry {
  const entry: FootprintEntry = {
    worksiteId: str(row.worksite_id),
    path: str(row.path),
    kind: str(row.kind) as PathKind,
    source: str(row.source) as FootprintSource,
    mode: str(row.mode) as FootprintMode,
    firstAt: str(row.first_at),
    lastAt: str(row.last_at),
  };
  if (bool(row.declared_mismatch)) entry.declaredMismatch = true;
  return entry;
}

function widerSource(a: FootprintSource, b: FootprintSource): FootprintSource {
  return strongestSource(a, b);
}

function widerMode(a: FootprintMode, b: FootprintMode): FootprintMode {
  return strongestMode(a, b);
}

/** Merge a stored row with a new observation of the same (worksite, path). */
function mergeEntry(stored: FootprintEntry, input: FootprintEntryInput, at: string): FootprintEntry {
  const merged: FootprintEntry = {
    worksiteId: stored.worksiteId,
    path: stored.path,
    kind: input.kind,
    source: widerSource(stored.source, input.source),
    mode: widerMode(stored.mode, input.mode),
    firstAt: stored.firstAt,
    lastAt: stored.lastAt >= at ? stored.lastAt : at,
  };
  if (stored.declaredMismatch || input.declaredMismatch) merged.declaredMismatch = true;
  return merged;
}

async function refreshRow(id: string, entry: FootprintEntry): Promise<void> {
  await run`
    UPDATE footprint
    SET kind = ${entry.kind}, source = ${entry.source}, mode = ${entry.mode},
        last_at = ${entry.lastAt}, declared_mismatch = ${entry.declaredMismatch ? 1 : 0}
    WHERE id = ${id}`;
}

async function insertRow(
  id: string,
  repoId: string,
  entry: FootprintEntry,
): Promise<void> {
  await run`
    INSERT INTO footprint
      (id, worksite_id, repo_id, path, kind, source, mode, first_at, last_at, declared_mismatch)
    VALUES
      (${id}, ${entry.worksiteId}, ${repoId}, ${entry.path}, ${entry.kind},
       ${entry.source}, ${entry.mode}, ${entry.firstAt}, ${entry.lastAt},
       ${entry.declaredMismatch ? 1 : 0})`;
}

/** Literal candidates of one overlap query: exact path, ancestors, subtree. */
function overlapConditions(path: string): { clause: string; params: SqlScalar[] } {
  const ancestors = parentDirs(path);
  let clause = `path = ? OR path LIKE ? OR kind = 'pattern'`;
  const params: SqlScalar[] = [path, likePrefix(path)];
  if (ancestors.length > 0) {
    clause += ` OR path IN (${ancestors.map(() => "?").join(", ")})`;
    ancestors.forEach((ancestor) => params.push(ancestor));
  }
  return { clause, params };
}

async function candidateRows(
  repoId: string,
  path: string,
): Promise<FootprintRow[]> {
  const { clause, params } = overlapConditions(path);
  const text =
    `SELECT * FROM footprint WHERE repo_id = ? AND (${clause}) ` +
    `ORDER BY path LIMIT ${OVERLAP_SCAN_LIMIT + PATTERN_SCAN_LIMIT}`;
  return allText<FootprintRow>(text, [repoId, ...params]);
}

/** True when the stored entry overlaps the queried path (globs included). */
function overlaps(row: FootprintRow, path: string, kind: PathKind): boolean {
  return entriesOverlap(path, kind, str(row.path), str(row.kind) as PathKind);
}

async function addFootprints(entries: FootprintEntryInput[]): Promise<FootprintEntry[]> {
  const worksiteIds = Array.from(new Set(entries.map((entry) => entry.worksiteId)));
  const repoIds = await repoIdsOfWorksites(worksiteIds);
  const saved: FootprintEntry[] = [];
  for (const input of entries) {
    const at = input.at ?? new Date().toISOString();
    const existing = await one<FootprintRow>`
      SELECT * FROM footprint
      WHERE worksite_id = ${input.worksiteId} AND path = ${input.path}`;
    if (existing) {
      const merged = mergeEntry(toEntry(existing), input, at);
      await refreshRow(str(existing.id), merged);
      saved.push(merged);
      continue;
    }
    const id = newId("fp");
    const entry: FootprintEntry = { ...input, firstAt: at, lastAt: at };
    if (input.declaredMismatch) entry.declaredMismatch = true;
    await insertRow(id, repoIds[input.worksiteId] ?? "", entry);
    saved.push(entry);
  }
  return saved;
}

async function listFootprintsByWorksite(worksiteId: string): Promise<FootprintEntry[]> {
  const rows = await all<FootprintRow>`
    SELECT * FROM footprint WHERE worksite_id = ${worksiteId} ORDER BY path`;
  return rows.map(toEntry);
}

async function listFootprintsByRepo(repoId: string): Promise<FootprintEntry[]> {
  const rows = await all<FootprintRow>`
    SELECT * FROM footprint WHERE repo_id = ${repoId} ORDER BY worksite_id, path`;
  return rows.map(toEntry);
}

async function findOverlappingFootprints(
  repoId: string,
  path: string,
  kind?: PathKind,
): Promise<FootprintEntry[]> {
  const queryKind = kind ?? classifyPath(path);
  const rows = await candidateRows(repoId, path);
  return rows.filter((row) => overlaps(row, path, queryKind)).map(toEntry);
}

async function removeFootprintsByWorksite(
  worksiteId: string,
  source?: FootprintSource,
): Promise<number> {
  if (source) {
    return run`
      DELETE FROM footprint WHERE worksite_id = ${worksiteId} AND source = ${source}`;
  }
  return run`DELETE FROM footprint WHERE worksite_id = ${worksiteId}`;
}

async function footprintCoverage(worksiteId: string): Promise<FootprintCoverage> {
  const rows = await all<{ source: string; total: number }>`
    SELECT source, COUNT(*) AS total FROM footprint
    WHERE worksite_id = ${worksiteId} GROUP BY source`;
  const coverage: FootprintCoverage = {};
  rows.forEach((row) => {
    coverage[str(row.source) as FootprintSource] = Number(row.total);
  });
  return coverage;
}

export function createFootprintStore(): FootprintStore {
  return {
    add: addFootprints,
    listByWorksite: listFootprintsByWorksite,
    listByRepo: listFootprintsByRepo,
    findOverlapping: findOverlappingFootprints,
    removeByWorksite: removeFootprintsByWorksite,
    coverage: footprintCoverage,
  };
}

/** DELETE affected-row helper kept explicit for readability at call sites. */
export async function deleteWhere(text: string, params: SqlScalar[]): Promise<number> {
  return runText(text, params);
}