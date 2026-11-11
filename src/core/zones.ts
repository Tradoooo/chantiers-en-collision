/**
 * core/zones — default catalog and zone resolution (spec §6).
 * A zone names a part of the repository and gives it a behaviour.
 */

import { literalPrefix, matchesGlob } from "./paths";
import type { Zone, ZoneNature } from "./types";

export interface ZoneCatalogEntry {
  name: string;
  patterns: string[];
  nature: ZoneNature;
}

/** Default catalog applied when a repo is registered (spec §6). */
export const DEFAULT_ZONE_CATALOG: ZoneCatalogEntry[] = [
  { name: "migrations", patterns: ["**/migrations/**"], nature: "exclusive" },
  {
    name: "lockfiles",
    patterns: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "go.sum"],
    nature: "exclusive",
  },
  { name: "schema", patterns: ["schema.prisma"], nature: "exclusive" },
  { name: "api-contracts", patterns: ["openapi*.y*ml"], nature: "exclusive" },
  { name: "routes", patterns: ["**/routes.*"], nature: "hotspot" },
  { name: "locales", patterns: ["**/locales/**", "**/i18n/**"], nature: "hotspot" },
  { name: "build-output", patterns: ["dist/**"], nature: "out-of-scope" },
  { name: "snapshots", patterns: ["**/__snapshots__/**"], nature: "out-of-scope" },
  { name: "generated", patterns: ["*.generated.*"], nature: "out-of-scope" },
];

/** Specificity: longest literal prefix wins, then longest pattern. */
function specificity(pattern: string): [number, number] {
  return [literalPrefix(pattern).length, pattern.length];
}

/**
 * The zone that applies to a path. The most specific matching pattern wins
 * (team zones and catalog zones compete on equal footing); if the winner is
 * out-of-scope, the path is ignored (undefined).
 */
export function zoneForPath(zones: Zone[], path: string): Zone | undefined {
  let best: Zone | undefined;
  let bestPattern = "";
  let bestSpec: [number, number] = [-1, -1];
  for (const zone of zones) {
    for (const pattern of zone.patterns) {
      if (!matchesGlob(pattern, path)) continue;
      const spec = specificity(pattern);
      if (spec[0] > bestSpec[0] || (spec[0] === bestSpec[0] && spec[1] > bestSpec[1])) {
        best = zone;
        bestPattern = pattern;
        bestSpec = spec;
      }
    }
  }
  void bestPattern;
  if (!best) return undefined;
  return best.nature === "out-of-scope" ? undefined : best;
}

/** True while a frozen zone is within [frozenFrom, frozenTo] at `now` (ISO). */
export function isFrozen(zone: Zone, now: string): boolean {
  if (zone.nature !== "frozen") return false;
  if (zone.frozenFrom && now < zone.frozenFrom) return false;
  if (zone.frozenTo && now > zone.frozenTo) return false;
  return true;
}
