/**
 * core/collisions — overlap detection between worksites (spec §7, §17).
 * One collision per pair of worksites AND per zone: worst degree kept,
 * representative path recorded, normalized worksiteA < worksiteB ordering.
 */

import { computeDegree, hasThirdPartyReservation } from "./degrees";
import { classifyPath, entriesOverlap, literalPrefix, matchesGlob, normalizePath } from "./paths";
import { isFrozen, zoneForPath } from "./zones";
import type {
  Collision,
  CollisionDraft,
  CollisionPhase,
  Degree,
  FootprintEntry,
  Reservation,
  Worksite,
  Zone,
} from "./types";

export interface WorksiteWithEntries {
  worksite: Worksite;
  entries: FootprintEntry[];
}

export interface DetectOptions {
  zones: Zone[];
  reservations: Reservation[];
  now: string;
  hardMode: boolean;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isOutOfScope(path: string, zones: Zone[]): boolean {
  return zones.some(
    (z) => z.nature === "out-of-scope" && z.patterns.some((p) => matchesGlob(p, path)),
  );
}

const KIND_RANK = { file: 0, dir: 1, pattern: 2 } as const;

/** Most concrete path of an overlapping pair, for display and zone lookup. */
function representativePath(a: FootprintEntry, b: FootprintEntry): string {
  const ordered = KIND_RANK[a.kind] <= KIND_RANK[b.kind] ? [a, b] : [b, a];
  for (const entry of ordered) {
    if (entry.kind !== "pattern") return normalizePath(entry.path);
  }
  return literalPrefix(a.path) || literalPrefix(b.path) || normalizePath(a.path);
}

function zoneForEntries(
  a: FootprintEntry,
  b: FootprintEntry,
  zones: Zone[],
  repPath: string,
): Zone | undefined {
  const direct = zoneForPath(zones, repPath);
  if (direct) return direct;
  if (repPath === "") return undefined;
  // Patterns: try the literal prefixes of both sides.
  for (const entry of [a, b]) {
    if (entry.kind === "pattern") {
      const z = zoneForPath(zones, literalPrefix(entry.path));
      if (z) return z;
    }
  }
  return undefined;
}

function isPredictedOnly(w: WorksiteWithEntries): boolean {
  if (w.worksite.state === "planned") return true;
  return w.entries.length > 0 && w.entries.every((e) => e.source === "predicted");
}

function normalizePair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function betterDraft(candidate: CollisionDraft, existing?: CollisionDraft): boolean {
  if (!existing) return true;
  if (candidate.degree !== existing.degree) return candidate.degree > existing.degree;
  return candidate.rawDegree > existing.rawDegree;
}

function entryMatchesZone(entry: FootprintEntry, zone: Zone): boolean {
  if (entry.kind !== "pattern") {
    return zone.patterns.some((p) => matchesGlob(p, entry.path));
  }
  const prefix = literalPrefix(entry.path);
  return prefix !== "" && zone.patterns.some((p) => matchesGlob(p, prefix));
}

/**
 * Phase of a collision (spec §13 four numbers):
 * "pr" when a PR is open on either side, "before-code" when prediction-only,
 * else "live". ("missed" comes from real conflicts, never from here.)
 */
export function phaseFor(a: Worksite, b: Worksite, predictedOnly: boolean): CollisionPhase {
  if (a.prOpen || b.prOpen || a.state === "review" || b.state === "review") return "pr";
  if (predictedOnly) return "before-code";
  return "live";
}

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

function overlapDrafts(
  subject: WorksiteWithEntries,
  other: WorksiteWithEntries,
  opts: DetectOptions,
): Map<string, CollisionDraft> {
  const byZone = new Map<string, CollisionDraft>();
  const [aId, bId] = normalizePair(subject.worksite.id, other.worksite.id);
  const predictedOnly = isPredictedOnly(subject) || isPredictedOnly(other);
  const neighborDormant = other.worksite.state === "dormant";

  for (const ea of subject.entries) {
    if (isOutOfScope(ea.path, opts.zones)) continue;
    for (const eb of other.entries) {
      if (isOutOfScope(eb.path, opts.zones)) continue;
      if (!entriesOverlap(ea.path, ea.kind, eb.path, eb.kind)) continue;
      const path = representativePath(ea, eb);
      const zone = zoneForEntries(ea, eb, opts.zones, path);
      const result = computeDegree({
        entryA: ea,
        entryB: eb,
        zone,
        frozen: zone !== undefined && isFrozen(zone, opts.now),
        reservedByOther: hasThirdPartyReservation(
          opts.reservations,
          [subject.worksite.id, other.worksite.id],
          path,
          opts.now,
        ),
        neighborDormant,
        predictedOnly,
      });
      const key = zone?.id ?? "";
      const draft: CollisionDraft = {
        repoId: subject.worksite.repoId,
        worksiteA: aId,
        worksiteB: bId,
        zoneId: zone?.id,
        path,
        degree: result.degree,
        rawDegree: result.rawDegree,
        phase: phaseFor(subject.worksite, other.worksite, predictedOnly),
        probable: result.probable || undefined,
      };
      if (betterDraft(draft, byZone.get(key))) byZone.set(key, draft);
    }
  }
  return byZone;
}

/** Degree for a shared named zone WITHOUT direct path overlap. */
function sharedZoneDegree(
  zone: Zone,
  opts: DetectOptions,
  predictedOnly: boolean,
  neighborDormant: boolean,
): { degree: Degree; raw: Degree; probable: boolean } {
  // Exclusive = one worksite at a time (spec §6): different files still D4.
  // Frozen zone inside its window: new worksites refused → D4 too.
  let raw: Degree = 0;
  if (zone.nature === "exclusive") raw = 4;
  else if (zone.nature === "frozen" && isFrozen(zone, opts.now)) raw = 4;
  let degree: Degree = raw;
  if (zone.nature === "hotspot" && degree > 0) degree = (degree - 1) as Degree;
  if (neighborDormant && degree > 0) degree = (degree - 1) as Degree;
  const probable = predictedOnly;
  if (probable && degree > 1) degree = 1;
  return { degree, raw, probable };
}

/**
 * Reservation-driven collisions: an active reservation of `other` covering a
 * subject entry is D4 even when `other` declared no footprint at all
 * (a reservation is a claim on the ground — spec §8 "Attendre").
 */
function addReservationDrafts(
  subject: WorksiteWithEntries,
  other: WorksiteWithEntries,
  opts: DetectOptions,
  byZone: Map<string, CollisionDraft>,
): void {
  const theirs = opts.reservations.filter(
    (r) => r.worksiteId === other.worksite.id && !r.releasedAt && r.expiresAt > opts.now,
  );
  if (theirs.length === 0) return;
  const [aId, bId] = normalizePair(subject.worksite.id, other.worksite.id);
  const predictedOnly = isPredictedOnly(subject) || isPredictedOnly(other);
  for (const r of theirs) {
    for (const e of subject.entries) {
      if (isOutOfScope(e.path, opts.zones)) continue;
      const hit = r.patterns.some((p) => entriesOverlap(p, classifyPath(p), e.path, e.kind));
      if (!hit) continue;
      const path = normalizePath(e.path);
      const zone = zoneForPath(opts.zones, path);
      const key = zone?.id ?? "";
      const draft: CollisionDraft = {
        repoId: subject.worksite.repoId,
        worksiteA: aId,
        worksiteB: bId,
        zoneId: zone?.id,
        path,
        degree: predictedOnly ? 1 : 4,
        rawDegree: 4,
        phase: phaseFor(subject.worksite, other.worksite, predictedOnly),
        probable: predictedOnly || undefined,
      };
      if (betterDraft(draft, byZone.get(key))) byZone.set(key, draft);
    }
  }
}

/** D0 (or D4 on exclusive/frozen) drafts for shared zones without overlap. */
function sharedZoneDrafts(
  subject: WorksiteWithEntries,
  other: WorksiteWithEntries,
  opts: DetectOptions,
  byZone: Map<string, CollisionDraft>,
): void {
  const [aId, bId] = normalizePair(subject.worksite.id, other.worksite.id);
  const predictedOnly = isPredictedOnly(subject) || isPredictedOnly(other);
  const neighborDormant = other.worksite.state === "dormant";
  for (const zone of opts.zones) {
    if (zone.nature === "out-of-scope" || byZone.has(zone.id)) continue;
    const mine = subject.entries.find(
      (e) => !isOutOfScope(e.path, opts.zones) && entryMatchesZone(e, zone),
    );
    const theirs = other.entries.find(
      (e) => !isOutOfScope(e.path, opts.zones) && entryMatchesZone(e, zone),
    );
    if (!mine || !theirs) continue;
    const d = sharedZoneDegree(zone, opts, predictedOnly, neighborDormant);
    byZone.set(zone.id, {
      repoId: subject.worksite.repoId,
      worksiteA: aId,
      worksiteB: bId,
      zoneId: zone.id,
      path: normalizePath(theirs.path),
      degree: d.degree,
      rawDegree: d.raw,
      phase: phaseFor(subject.worksite, other.worksite, predictedOnly),
      probable: d.probable || undefined,
    });
  }
}

/**
 * Detect collisions between `subject` and every other open worksite.
 * Out-of-scope paths are ignored; same-pilot pairs get NO discount.
 */
export function detectCollisions(
  subject: WorksiteWithEntries,
  others: WorksiteWithEntries[],
  opts: DetectOptions,
): CollisionDraft[] {
  const drafts: CollisionDraft[] = [];
  for (const other of others) {
    if (other.worksite.id === subject.worksite.id) continue;
    if (other.worksite.state === "closed") continue;
    const byZone = overlapDrafts(subject, other, opts);
    addReservationDrafts(subject, other, opts, byZone);
    sharedZoneDrafts(subject, other, opts, byZone);
    drafts.push(...byZone.values());
  }
  return drafts;
}

/** Convenience: the worst collision of a list, or undefined. */
export function worstCollision(collisions: Collision[]): Collision | undefined {
  let worst: Collision | undefined;
  for (const c of collisions) {
    if (!worst || c.degree > worst.degree) worst = c;
  }
  return worst;
}
