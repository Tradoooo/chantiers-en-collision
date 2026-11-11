/**
 * storage/memory/collisions — CollisionStore.
 *
 * One collision per (repoId, sorted pair worksiteA < worksiteB, zoneId): the
 * first detection fixes `detectedAt`, later detections only refresh the
 * degree / path / phase / probable (spec §17 step 5, CONTRACTS "one collision
 * per (pair, zone)").
 */

import type { Collision, CollisionDraft, ResolutionChoice } from "../../core/types";
import type { CollisionStore } from "../interfaces";
import { clone } from "./clone";
import type { IdGen } from "./ids";
import type { MemoryData } from "./state";
import { nowIso } from "./util";

/** Normalized ordering of the pair, so (A,B) and (B,A) are the same row. */
function sortedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function collisionKey(repoId: string, a: string, b: string, zoneId?: string): string {
  return [repoId, a, b, zoneId ?? ""].join("\u0000");
}

function created(draft: CollisionDraft, a: string, b: string, ids: IdGen): Collision {
  const collision: Collision = {
    id: ids("col"),
    repoId: draft.repoId,
    worksiteA: a,
    worksiteB: b,
    path: draft.path,
    degree: draft.degree,
    rawDegree: draft.rawDegree,
    phase: draft.phase,
    state: draft.state ?? "open",
    detectedAt: draft.detectedAt ?? nowIso(),
  };
  if (draft.zoneId !== undefined) collision.zoneId = draft.zoneId;
  if (draft.resolution !== undefined) collision.resolution = draft.resolution;
  if (draft.resolvedBy !== undefined) collision.resolvedBy = draft.resolvedBy;
  if (draft.reason !== undefined) collision.reason = draft.reason;
  if (draft.probable !== undefined) collision.probable = draft.probable;
  return collision;
}

/** Re-detection: detectedAt and the resolution fields of the row are kept. */
function refreshed(existing: Collision, draft: CollisionDraft, a: string, b: string): Collision {
  const collision: Collision = {
    ...existing,
    worksiteA: a,
    worksiteB: b,
    path: draft.path,
    degree: draft.degree,
    rawDegree: draft.rawDegree,
    phase: draft.phase,
    state: draft.state ?? existing.state,
  };
  if (draft.probable !== undefined) collision.probable = draft.probable;
  return collision;
}

/** Oldest detection first; the id breaks ties (total order). */
const byDetected = (a: Collision, b: Collision): number =>
  a.detectedAt.localeCompare(b.detectedAt) || a.id.localeCompare(b.id);

function matchingCollisions(
  data: MemoryData,
  keep: (c: Collision) => boolean,
  activeOnly?: boolean,
): Collision[] {
  const out: Collision[] = [];
  for (const c of data.collisions.values()) {
    if (activeOnly && c.state !== "open") continue;
    if (keep(c)) out.push(clone(c));
  }
  return out.sort(byDetected);
}

function collisionEntryOfId(data: MemoryData, id: string): [string, Collision] | undefined {
  for (const entry of data.collisions.entries()) {
    if (entry[1].id === id) return entry;
  }
  return undefined;
}

async function upsertCollision(
  data: MemoryData,
  ids: IdGen,
  draft: CollisionDraft,
): Promise<Collision> {
  const [a, b] = sortedPair(draft.worksiteA, draft.worksiteB);
  const key = collisionKey(draft.repoId, a, b, draft.zoneId);
  const known = data.collisions.get(key);
  const stored = known ? refreshed(known, draft, a, b) : created(draft, a, b, ids);
  data.collisions.set(key, stored);
  return clone(stored);
}

async function findCollisionById(data: MemoryData, id: string): Promise<Collision | undefined> {
  const found = collisionEntryOfId(data, id);
  return found ? clone(found[1]) : undefined;
}

async function listCollisionsByRepo(
  data: MemoryData,
  repoId: string,
  activeOnly?: boolean,
): Promise<Collision[]> {
  return matchingCollisions(data, (c) => c.repoId === repoId, activeOnly);
}

async function listCollisionsByWorksite(
  data: MemoryData,
  worksiteId: string,
  activeOnly?: boolean,
): Promise<Collision[]> {
  return matchingCollisions(
    data,
    (c) => c.worksiteA === worksiteId || c.worksiteB === worksiteId,
    activeOnly,
  );
}

async function listCollisionsByIds(data: MemoryData, idsWanted: string[]): Promise<Collision[]> {
  const byId = new Map<string, Collision>();
  for (const c of data.collisions.values()) byId.set(c.id, c);
  const out: Collision[] = [];
  for (const id of idsWanted) {
    const found = byId.get(id);
    if (found) out.push(clone(found));
  }
  return out;
}

async function resolveCollision(
  data: MemoryData,
  id: string,
  resolution: ResolutionChoice | undefined,
  resolvedBy: string,
  reason?: string,
): Promise<Collision | undefined> {
  const found = collisionEntryOfId(data, id);
  if (!found) return undefined;
  const stored: Collision = { ...found[1], state: "resolved", resolvedBy };
  if (resolution !== undefined) stored.resolution = resolution;
  if (reason !== undefined) stored.reason = reason;
  data.collisions.set(found[0], stored);
  return clone(stored);
}

async function countCollisionsByPhase(
  data: MemoryData,
  repoId?: string,
  since?: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = { "before-code": 0, live: 0, pr: 0 };
  for (const c of data.collisions.values()) {
    if (c.state !== "open") continue;
    if (repoId !== undefined && c.repoId !== repoId) continue;
    if (since !== undefined && c.detectedAt < since) continue;
    out[c.phase] = (out[c.phase] ?? 0) + 1;
  }
  return out;
}

export function createCollisionStore(data: MemoryData, ids: IdGen): CollisionStore {
  return {
    upsert: (draft) => upsertCollision(data, ids, draft),
    findById: (id) => findCollisionById(data, id),
    listByRepo: (repoId, activeOnly) => listCollisionsByRepo(data, repoId, activeOnly),
    listByWorksite: (worksiteId, activeOnly) =>
      listCollisionsByWorksite(data, worksiteId, activeOnly),
    listByIds: (idsWanted) => listCollisionsByIds(data, idsWanted),
    resolve: (id, resolution, resolvedBy, reason) =>
      resolveCollision(data, id, resolution, resolvedBy, reason),
    countByPhase: (repoId, since) => countCollisionsByPhase(data, repoId, since),
  };
}
