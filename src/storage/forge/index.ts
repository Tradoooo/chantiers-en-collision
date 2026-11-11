/**
 * storage/forge — Forge SQL implementation of every store.
 *
 * The ONLY place (with schema.ts) importing "@forge/sql" (through db.ts).
 * Each store lives in its own file; this index re-assembles the Stores
 * bundle expected by src/services/ctx.ts.
 */

import type { Stores } from "../interfaces";
import { createRepoStore, createZoneStore } from "./repos";
import { createSessionStore } from "./sessions";
import { createWorksiteStore } from "./worksites";
import { createFootprintStore } from "./footprints";
import { createCollisionStore } from "./collisions";
import { createReservationStore } from "./reservations";
import { createNoticeStore } from "./notices";
import { createPredictionStore } from "./predictions";
import {
  createConflictStore,
  createEventStore,
  createRulesStore,
  createTokenStore,
} from "./misc";

export function createForgeStores(): Stores {
  const zones = createZoneStore();
  return {
    repos: createRepoStore({ seedZones: (repoId) => zones.seedDefaults(repoId).then(() => undefined) }),
    zones,
    sessions: createSessionStore(),
    worksites: createWorksiteStore(),
    footprints: createFootprintStore(),
    collisions: createCollisionStore(),
    reservations: createReservationStore(),
    notices: createNoticeStore(),
    predictions: createPredictionStore(),
    conflicts: createConflictStore(),
    tokens: createTokenStore(),
    events: createEventStore(),
    rules: createRulesStore(),
  };
}
