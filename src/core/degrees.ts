/**
 * core/degrees — collision degree D0..D5 and its modulations (spec §7).
 *
 * Raw degrees:
 *  - D4: exclusive zone, frozen zone, or active reservation by a third worksite
 *  - D3: same file and either side deletes/renames it
 *  - D2: same file
 *  - D1: same directory (containment, different files)
 *  - D0: same named zone, different files (no path overlap)
 * Modulations: hotspot −1, dormant neighbour −1, prediction-only capped D1
 * (probable). Two agents of the same pilot get NO discount (spec §7).
 */

import { classifyPath, matchesGlob, normalizePath, pathContains } from "./paths";
import type { Degree, FootprintEntry, Reservation, Zone } from "./types";

export interface DegreeInput {
  entryA: FootprintEntry;
  entryB: FootprintEntry;
  /** Zone resolved for the overlapping path (undefined = ordinary). */
  zone?: Zone;
  /** Zone is frozen right now. */
  frozen: boolean;
  /** An active reservation by a THIRD worksite covers the path. */
  reservedByOther: boolean;
  /** The neighbouring worksite is dormant. */
  neighborDormant: boolean;
  /** At least one side is prediction-only. */
  predictedOnly: boolean;
}

export interface DegreeResult {
  /** Degree after modulation. */
  degree: Degree;
  /** Degree before modulation. */
  rawDegree: Degree;
  /** True when capped to D1 because a side is prediction-only. */
  probable: boolean;
}

function clampDegree(d: number): Degree {
  return Math.min(5, Math.max(0, Math.round(d))) as Degree;
}

function isDestructive(mode: FootprintEntry["mode"]): boolean {
  return mode === "delete" || mode === "rename";
}

/** Both entries denote the very same file. */
function sameFile(a: FootprintEntry, b: FootprintEntry): boolean {
  return (
    a.kind === "file" &&
    b.kind === "file" &&
    normalizePath(a.path) === normalizePath(b.path)
  );
}

/**
 * File-level clash: a specific file is covered by the other entry (same
 * file, dir containing the file, or pattern matching it). A declared dir
 * means "every file inside", so dir ⊇ file counts as same file (spec §22.1).
 * Dir vs dir stays folder-level (D1).
 */
function fileLevelClash(a: FootprintEntry, b: FootprintEntry): boolean {
  if (sameFile(a, b)) return true;
  if (a.kind === "file" && b.kind === "dir") return pathContains(b.path, a.path);
  if (b.kind === "file" && a.kind === "dir") return pathContains(a.path, b.path);
  if (a.kind === "pattern" && b.kind === "file") return matchesGlob(a.path, b.path);
  if (b.kind === "pattern" && a.kind === "file") return matchesGlob(b.path, a.path);
  return false;
}

function rawDegreeOf(input: DegreeInput): Degree {
  const { entryA: a, entryB: b, zone, frozen, reservedByOther } = input;
  if ((zone !== undefined && zone.nature === "exclusive") || frozen || reservedByOther) {
    return 4;
  }
  if (fileLevelClash(a, b)) {
    return isDestructive(a.mode) || isDestructive(b.mode) ? 3 : 2;
  }
  // Any remaining overlap is folder-level (dir/dir or compatible patterns):
  // same directory.
  return 1;
}

/** Apply the modulations of spec §7 to the raw degree. */
export function computeDegree(input: DegreeInput): DegreeResult {
  const raw = rawDegreeOf(input);
  let degree = raw;
  if (input.zone !== undefined && input.zone.nature === "hotspot" && degree > 0) {
    degree = clampDegree(degree - 1);
  }
  if (input.neighborDormant && degree > 0) {
    degree = clampDegree(degree - 1);
  }
  const probable = input.predictedOnly;
  if (probable && degree > 1) {
    degree = 1;
  }
  return { degree, rawDegree: raw, probable };
}

function covers(reservation: Reservation, path: string): boolean {
  return reservation.patterns.some((pattern) => {
    const kind = classifyPath(pattern);
    if (kind === "pattern") return matchesGlob(pattern, path);
    if (kind === "dir") {
      const n = normalizePath(pattern);
      const p = normalizePath(path);
      return p === n || p.startsWith(n + "/");
    }
    return normalizePath(pattern) === normalizePath(path);
  });
}

/**
 * True when an active reservation of a worksite OUTSIDE the pair overlaps
 * the path. `now` is optional for stub-compatibility; defaults to the
 * current time — callers inside services should pass ctx.now().
 */
export function hasThirdPartyReservation(
  reservations: Reservation[],
  worksiteIds: [string, string],
  path: string,
  now?: string,
): boolean {
  const reference = now ?? new Date().toISOString();
  return reservations.some(
    (r) =>
      !r.releasedAt &&
      r.expiresAt > reference &&
      r.worksiteId !== worksiteIds[0] &&
      r.worksiteId !== worksiteIds[1] &&
      covers(r, path),
  );
}
