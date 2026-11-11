/**
 * storage/memory — in-memory implementation of every store.
 * Owner: workstream F. Replace the stub; keep the signature EXACTLY.
 *
 * Used by: unit tests, acceptance scenarios (tests/scenarios/recette.test.ts)
 * and the simulation console. Must honour the interface semantics documented
 * in src/storage/interfaces.ts, especially:
 *  - FootprintStore.findOverlapping: index (repoId, path) semantics —
 *    exact path + each parent dir for a file; entries starting with a dir;
 *    glob patterns matched through core/paths.entriesOverlap. Closed worksites
 *    are NOT filtered here (services do it), but `repoId` scoping is exact.
 *  - CollisionStore.upsert: one collision per (repoId, sorted pair, zoneId);
 *    keeps the FIRST detectedAt, updates degree/path/phase on re-detection.
 *  - NoticeStore: recipients registered at post time; pendingFor returns
 *    undelivered notices for the given worksites, oldest first; markDelivered
 *    is idempotent (a notice is delivered ONCE per worksite).
 *  - ReservationStore.listActive: not released AND expiresAt > now.
 *  - ids: any unique opaque string (counter-based is fine: "ws-1", "col-3"...).
 *  - WorksiteStore.findByIssue returns non-closed worksites only, newest first.
 */

import type { RepoRecord, Zone } from "../../core/types";
import type { Stores } from "../interfaces";

export interface MemorySeed {
  repos?: RepoRecord[];
  zones?: Zone[];
}

export function createMemoryStores(_seed?: MemorySeed): Stores {
  throw new Error("TODO(memory): not implemented — see docs/CONTRACTS.md");
}
