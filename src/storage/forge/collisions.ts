/**
 * storage/forge/collisions — CollisionStore over Forge SQL.
 * Owner: workstream E.
 *
 * Semantics (src/storage/interfaces.ts + memory stub docstrings):
 *  - ONE collision per (repoId, sorted pair of worksites, zoneId);
 *  - the pair is normalized (worksiteA < worksiteB) before the lookup;
 *  - the FIRST detectedAt is kept — a re-detection only refreshes the
 *    degree, the path and the phase (CONTRACTS.md);
 *  - a collision that was resolved and is detected again re-opens
 *    (the conflict is live once more) unless the draft says otherwise.
 */

import type {
  Collision,
  CollisionDraft,
  CollisionPhase,
  CollisionState,
  Degree,
  ResolutionChoice,
} from "../../core/types";
import type { CollisionStore } from "../interfaces";
import { all, allText, bool, newId, one, optStr, run, str, upsert } from "./db";
import type { SqlScalar } from "./db";

interface CollisionRow {
  id: string;
  repo_id: string;
  worksite_a: string;
  worksite_b: string;
  zone_id: string;
  path: string;
  degree: number;
  raw_degree: number;
  phase: string;
  state: string;
  resolution: string;
  resolved_by: string;
  reason: string;
  detected_at: string;
  probable: number;
}

function toCollision(row: CollisionRow): Collision {
  const collision: Collision = {
    id: str(row.id),
    repoId: str(row.repo_id),
    worksiteA: str(row.worksite_a),
    worksiteB: str(row.worksite_b),
    path: str(row.path),
    degree: Number(row.degree) as Degree,
    rawDegree: Number(row.raw_degree) as Degree,
    phase: str(row.phase) as CollisionPhase,
    state: str(row.state) as CollisionState,
    detectedAt: str(row.detected_at),
  };
  const zoneId = optStr(row.zone_id);
  if (zoneId) collision.zoneId = zoneId;
  const resolution = optStr(row.resolution);
  if (resolution) collision.resolution = resolution as ResolutionChoice;
  const resolvedBy = optStr(row.resolved_by);
  if (resolvedBy) collision.resolvedBy = resolvedBy;
  const reason = optStr(row.reason);
  if (reason) collision.reason = reason;
  if (bool(row.probable)) collision.probable = true;
  return collision;
}

/** Sorted pair — the identity of a collision (CONTRACTS.md). */
export function sortedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

async function findByKey(
  repoId: string,
  worksiteA: string,
  worksiteB: string,
  zoneId: string,
): Promise<CollisionRow | undefined> {
  return one<CollisionRow>`
    SELECT * FROM collision
    WHERE repo_id = ${repoId}
      AND worksite_a = ${worksiteA}
      AND worksite_b = ${worksiteB}
      AND zone_id = ${zoneId}`;
}

function collisionValues(collision: Collision): SqlScalar[] {
  return [
    collision.repoId,
    collision.worksiteA,
    collision.worksiteB,
    collision.zoneId ?? "",
    collision.path,
    collision.degree,
    collision.rawDegree,
    collision.phase,
    collision.state,
    collision.resolution ?? "",
    collision.resolvedBy ?? "",
    collision.reason ?? "",
    collision.detectedAt,
    collision.probable ? 1 : 0,
  ];
}

const COLLISION_COLUMNS = [
  "repo_id",
  "worksite_a",
  "worksite_b",
  "zone_id",
  "path",
  "degree",
  "raw_degree",
  "phase",
  "state",
  "resolution",
  "resolved_by",
  "reason",
  "detected_at",
  "probable",
];

async function upsertCollision(draft: CollisionDraft): Promise<Collision> {
  const [worksiteA, worksiteB] = sortedPair(draft.worksiteA, draft.worksiteB);
  const zoneId = draft.zoneId ?? "";
  const detectedAt = draft.detectedAt ?? new Date().toISOString();
  const existing = await findByKey(draft.repoId, worksiteA, worksiteB, zoneId);
  // The draft wins when it states a state; otherwise a recorded
  // resolution is preserved (never silently un-resolved).
  const state: CollisionState = draft.state ?? (existing ? toCollision(existing).state : "open");
  const collision: Collision = {
    ...draft,
    id: existing ? str(existing.id) : newId("col"),
    worksiteA,
    worksiteB,
    state,
    detectedAt: existing ? str(existing.detected_at) : detectedAt,
  };
  await upsert("collision", collision.id, COLLISION_COLUMNS, collisionValues(collision));
  return collision;
}

async function findCollisionById(id: string): Promise<Collision | undefined> {
  const row = await one<CollisionRow>`SELECT * FROM collision WHERE id = ${id}`;
  return row ? toCollision(row) : undefined;
}

async function listCollisionsByRepo(
  repoId: string,
  activeOnly?: boolean,
): Promise<Collision[]> {
  const rows = activeOnly
    ? await all<CollisionRow>`
        SELECT * FROM collision WHERE repo_id = ${repoId} AND state = 'open'
        ORDER BY detected_at DESC`
    : await all<CollisionRow>`
        SELECT * FROM collision WHERE repo_id = ${repoId} ORDER BY detected_at DESC`;
  return rows.map(toCollision);
}

async function listCollisionsByWorksite(
  worksiteId: string,
  activeOnly?: boolean,
): Promise<Collision[]> {
  const rows = activeOnly
    ? await all<CollisionRow>`
        SELECT * FROM collision
        WHERE (worksite_a = ${worksiteId} OR worksite_b = ${worksiteId})
          AND state = 'open'
        ORDER BY detected_at DESC`
    : await all<CollisionRow>`
        SELECT * FROM collision
        WHERE worksite_a = ${worksiteId} OR worksite_b = ${worksiteId}
        ORDER BY detected_at DESC`;
  return rows.map(toCollision);
}

async function listCollisionsByIds(ids: string[]): Promise<Collision[]> {
  if (ids.length === 0) return [];
  const rows = await all<CollisionRow>`SELECT * FROM collision WHERE id IN (${ids})`;
  return rows.map(toCollision);
}

async function resolveCollision(
  id: string,
  resolution: Collision["resolution"],
  resolvedBy: string,
  reason?: string,
): Promise<Collision | undefined> {
  const affected = await run`
    UPDATE collision
    SET state = 'resolved', resolution = ${resolution ?? ""},
        resolved_by = ${resolvedBy}, reason = ${reason ?? ""}
    WHERE id = ${id}`;
  if (affected <= 0) return undefined;
  return findCollisionById(id);
}

async function countCollisionsByPhase(
  repoId?: string,
  since?: string,
): Promise<Record<string, number>> {
  let text = `SELECT phase, COUNT(*) AS total FROM collision WHERE 1 = 1`;
  const params: SqlScalar[] = [];
  if (repoId) {
    text += ` AND repo_id = ?`;
    params.push(repoId);
  }
  if (since) {
    text += ` AND detected_at >= ?`;
    params.push(since);
  }
  text += ` GROUP BY phase`;
  const rows = await allText<{ phase: string; total: number }>(text, params);
  const counts: Record<string, number> = {};
  rows.forEach((row) => {
    counts[str(row.phase)] = Number(row.total);
  });
  return counts;
}

export function createCollisionStore(): CollisionStore {
  return {
    upsert: upsertCollision,
    findById: findCollisionById,
    listByRepo: listCollisionsByRepo,
    listByWorksite: listCollisionsByWorksite,
    listByIds: listCollisionsByIds,
    resolve: resolveCollision,
    countByPhase: countCollisionsByPhase,
  };
}
