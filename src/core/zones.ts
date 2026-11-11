/**
 * core/zones — default catalog and zone resolution (spec §6).
 * Owner: workstream A. Replace each stub; keep signatures EXACTLY.
 */

import type { Zone, ZoneNature } from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

export interface ZoneCatalogEntry {
  name: string;
  patterns: string[];
  nature: ZoneNature;
}

/**
 * Default catalog applied when a repo is registered (spec §6):
 *  - exclusive: **\/migrations/**, package-lock.json, pnpm-lock.yaml, yarn.lock,
 *    Cargo.lock, go.sum, schema.prisma, openapi*.y*ml
 *  - hotspot: **\/routes.*, **\/locales/**, **\/i18n/**
 *  - out-of-scope: dist/**, **\/__snapshots__/**, *.generated.*
 * ("frozen" zones are created by teams, never by the catalog.)
 */
export const DEFAULT_ZONE_CATALOG: ZoneCatalogEntry[] = [
  // TODO(zones): fill per the comment above
];

/**
 * The zone that applies to a path. Most specific patterns win; if the best
 * match is out-of-scope, return undefined (the path is ignored).
 */
export function zoneForPath(_zones: Zone[], _path: string): Zone | undefined {
  throw TODO("zones");
}

/** True while a frozen zone is within [frozenFrom, frozenTo] at `now` (ISO). */
export function isFrozen(_zone: Zone, _now: string): boolean {
  throw TODO("zones");
}
