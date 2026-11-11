/**
 * storage/memory — in-memory implementation of every store.
 * Owner: workstream F.
 *
 * Used by: unit tests, acceptance scenarios (tests/scenarios/recette.test.ts)
 * and the simulation console. Semantics follow src/storage/interfaces.ts:
 *  - ids: opaque, counter-based, unique per bundle ("repo-1", "zone-2", "ws-3"…).
 *  - every returned object is a defensive copy (see ./clone) — no internal
 *    reference ever escapes.
 *  - FootprintStore.findOverlapping: (repoId, path) index semantics delegated
 *    to core/paths.entriesOverlap; closed worksites are NOT filtered here
 *    (services do it), but the repo scoping is exact.
 *  - CollisionStore.upsert: one row per (repoId, sorted pair, zoneId), first
 *    detectedAt kept.
 *  - NoticeStore: recipients registered at post time; pendingFor = undelivered,
 *    oldest first; markDelivered idempotent (delivered ONCE per worksite).
 *  - ReservationStore.listActive: not released AND expiresAt > now.
 *  - WorksiteStore.findByIssue: non-closed only, newest first.
 *
 * Split across files under storage/memory/: ids, clone, util, state, repos
 * (+ zones), sessions, worksites, footprints, collisions, reservations,
 * notices, extras (predictions / conflicts / tokens / events / rules).
 */

import type { RepoRecord, Zone } from "../../core/types";
import type { Stores } from "../interfaces";
import { clone } from "./clone";
import { createCollisionStore } from "./collisions";
import {
  createConflictStore,
  createEventStore,
  createPredictionStore,
  createRulesStore,
  createTokenStore,
} from "./extras";
import { createFootprintStore } from "./footprints";
import { createIdGen, type IdGen } from "./ids";
import { createNoticeStore } from "./notices";
import { createRepoStore, createZoneStore } from "./repos";
import { createReservationStore } from "./reservations";
import { createSessionStore } from "./sessions";
import { createMemoryData, type MemoryData } from "./state";
import { normalizeSlug } from "./util";
import { createWorksiteStore } from "./worksites";

export interface MemorySeed {
  repos?: RepoRecord[];
  zones?: Zone[];
}

/**
 * Seed rows are inserted as given (their ids are kept, missing ids are
 * generated). Seeding never runs the default zone catalog: the caller decides
 * which zones exist, `RepoStore.ensure` is the only path that seeds defaults.
 */
function applySeed(data: MemoryData, ids: IdGen, seed?: MemorySeed): void {
  for (const repo of seed?.repos ?? []) {
    const stored: RepoRecord = {
      ...clone(repo),
      id: repo.id || ids("repo"),
      slug: normalizeSlug(repo.slug),
    };
    data.repos.set(stored.id, stored);
  }
  for (const zone of seed?.zones ?? []) {
    const stored: Zone = { ...clone(zone), id: zone.id || ids("zone") };
    data.zones.set(stored.id, stored);
  }
}

export function createMemoryStores(seed?: MemorySeed): Stores {
  const data = createMemoryData();
  const ids = createIdGen();
  applySeed(data, ids, seed);
  const zones = createZoneStore(data, ids);

  return {
    repos: createRepoStore(data, ids, zones),
    zones,
    sessions: createSessionStore(data, ids),
    worksites: createWorksiteStore(data, ids),
    footprints: createFootprintStore(data),
    collisions: createCollisionStore(data, ids),
    reservations: createReservationStore(data, ids),
    notices: createNoticeStore(data, ids),
    predictions: createPredictionStore(data),
    conflicts: createConflictStore(data, ids),
    tokens: createTokenStore(data),
    events: createEventStore(data),
    rules: createRulesStore(data),
  };
}
