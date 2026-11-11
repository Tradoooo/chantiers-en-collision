/**
 * storage/memory/state — the in-memory tables.
 *
 * A bundle owns one `MemoryData`. Keys of the maps are the natural business
 * keys (repo id, worksite id, (worksiteId, path), (repo, pair, zone)...), so
 * the upsert semantics of every store are a plain map lookup.
 */

import type {
  ActorSession,
  Collision,
  FootprintEntry,
  FootprintPrediction,
  HookToken,
  Notice,
  PriorityRules,
  RealConflict,
  RepoRecord,
  Reservation,
  Worksite,
  Zone,
  EventRecord,
} from "../../core/types";

/** One notice, one recipient worksite: delivered once (spec §17 step 6). */
export interface NoticeDelivery {
  noticeId: string;
  worksiteId: string;
  deliveredAt?: string;
}

export interface MemoryData {
  repos: Map<string, RepoRecord>;
  zones: Map<string, Zone>;
  sessions: Map<string, ActorSession>;
  worksites: Map<string, Worksite>;
  /** key: `${worksiteId}\u0000${path}` */
  footprints: Map<string, FootprintEntry>;
  /** key: `${repoId}\u0000${worksiteA}\u0000${worksiteB}\u0000${zoneId}` */
  collisions: Map<string, Collision>;
  reservations: Map<string, Reservation>;
  notices: Map<string, Notice>;
  /** key: `${noticeId}\u0000${worksiteId}` */
  deliveries: Map<string, NoticeDelivery>;
  /** key: `${issueKey}\u0000${repoId}` */
  predictions: Map<string, FootprintPrediction>;
  conflicts: Map<string, RealConflict>;
  /** key: token hash */
  tokens: Map<string, HookToken>;
  events: EventRecord[];
  rules: Map<string, PriorityRules>;
}

export function createMemoryData(): MemoryData {
  return {
    repos: new Map(),
    zones: new Map(),
    sessions: new Map(),
    worksites: new Map(),
    footprints: new Map(),
    collisions: new Map(),
    reservations: new Map(),
    notices: new Map(),
    deliveries: new Map(),
    predictions: new Map(),
    conflicts: new Map(),
    tokens: new Map(),
    events: [],
    rules: new Map(),
  };
}
