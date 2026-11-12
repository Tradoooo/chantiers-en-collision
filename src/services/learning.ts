/**
 * services/learning — learn from what happened (CC-25, spec §13).
 *
 * Two loops:
 *  - prediction accuracy: at merge, the predicted footprint is compared with
 *    the attested one; the rate is displayed per component and feeds the
 *    announced confidence;
 *  - zone reclassification: a path where overlaps NEVER produced a real
 *    conflict is proposed as a hotspot; a directory where they ALWAYS do is
 *    proposed as an exclusive resource. Proposals are advisory — the team
 *    decides in the project settings.
 */

import { classifyPath, matchesGlob, normalizePath, pathContains } from "../core/paths";
import { zoneForPath } from "../core/zones";
import type { CollisionStats, Worksite, Zone, ZoneNature } from "../core/types";
import type { Ctx } from "./ctx";
import { collisionStats } from "./planning";
import { resolveRepo } from "./shared";
import { fail } from "../core/errors";

/** A directory whose overlaps never conflict → suggest hotspot. */
export const HOTSPOT_MIN_COLLISIONS = 3;
/** A directory whose overlaps always conflict → suggest exclusive. */
export const EXCLUSIVE_MIN_CONFLICTS = 2;

export interface ComponentAccuracy {
  component: string;
  /** 0..1 — share of attested paths that were predicted. */
  accuracy: number;
  samples: number;
}

export interface ZoneProposal {
  /** Proposed pattern, e.g. "src/routes/**". */
  pattern: string;
  currentNature: ZoneNature;
  suggestedNature: ZoneNature;
  /** What the data says, in one sentence. */
  evidence: string;
  hits: number;
}

export interface LearningReport {
  accuracy: {
    overall?: number;
    byComponent: ComponentAccuracy[];
    samples: number;
  };
  proposals: ZoneProposal[];
  fourNumbers: CollisionStats;
}

/** Directory that owns a path ("src/a/b.ts" → "src/a"; root file → "."). */
function dirOf(path: string): string {
  const segs = normalizePath(path).split("/");
  segs.pop();
  return segs.join("/") || ".";
}

function predictedCovers(predicted: string, attestedPath: string): boolean {
  const kind = classifyPath(predicted);
  if (kind === "pattern") return matchesGlob(predicted, attestedPath);
  if (kind === "dir") return pathContains(predicted, attestedPath);
  return normalizePath(predicted) === attestedPath;
}

/** Predicted vs attested, per merged worksite, rolled up by component. */
async function accuracyOf(ctx: Ctx, repoId: string, merged: Worksite[]) {
  const perComponent = new Map<string, { hits: number; total: number }>();
  let hits = 0;
  let total = 0;
  for (const w of merged) {
    const predictions = await ctx.stores.predictions.findByIssue(w.issueKey, repoId);
    if (predictions.length === 0) continue;
    const entries = await ctx.stores.footprints.listByWorksite(w.id);
    const attested = entries.filter((e) => e.source === "attested");
    if (attested.length === 0) continue;
    const predicted = predictions.flatMap((p) => p.entries.map((e) => e.path));
    const matched = attested.filter((a) =>
      predicted.some((p) => predictedCovers(p, a.path)),
    ).length;
    hits += matched;
    total += attested.length;
    const components = w.ticket?.components?.length ? w.ticket.components : ["(none)"];
    for (const c of components) {
      const acc = perComponent.get(c) ?? { hits: 0, total: 0 };
      acc.hits += matched;
      acc.total += attested.length;
      perComponent.set(c, acc);
    }
  }
  const byComponent: ComponentAccuracy[] = [...perComponent.entries()]
    .map(([component, v]) => ({
      component,
      accuracy: Math.round((v.hits / v.total) * 100) / 100,
      samples: v.total,
    }))
    .sort((a, b) => b.samples - a.samples);
  return {
    overall: total > 0 ? Math.round((hits / total) * 100) / 100 : undefined,
    byComponent,
    samples: total,
  };
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Zone reclassification proposals from collisions vs real conflicts. */
async function proposalsFor(ctx: Ctx, repoId: string, zones: Zone[]): Promise<ZoneProposal[]> {
  const collisions = await ctx.stores.collisions.listByRepo(repoId, false);
  const conflicts = await ctx.stores.conflicts.list(repoId);

  const collidedDirs = new Map<string, number>();
  for (const c of collisions) bump(collidedDirs, dirOf(c.path));
  const conflictDirs = new Map<string, number>();
  for (const c of conflicts) {
    for (const p of c.paths) bump(conflictDirs, dirOf(p));
  }

  const proposals: ZoneProposal[] = [];
  const seen = new Set<string>();
  const propose = (dir: string, suggested: ZoneNature, evidence: string, hitsN: number) => {
    if (dir === "." || seen.has(dir)) return;
    const zone = zoneForPath(zones, dir);
    const current = zone?.nature ?? "ordinary";
    if (current === suggested || current === "out-of-scope") return;
    seen.add(dir);
    proposals.push({
      pattern: `${dir}/**`,
      currentNature: current,
      suggestedNature: suggested,
      evidence,
      hits: hitsN,
    });
  };

  for (const [dir, n] of conflictDirs) {
    if (n >= EXCLUSIVE_MIN_CONFLICTS) {
      propose(dir, "exclusive", `${n} real merge conflicts in this directory`, n);
    }
  }
  for (const [dir, n] of collidedDirs) {
    if (n >= HOTSPOT_MIN_COLLISIONS && (conflictDirs.get(dir) ?? 0) === 0) {
      propose(dir, "hotspot", `${n} overlaps, never a real conflict`, n);
    }
  }
  return proposals.sort((a, b) => b.hits - a.hits).slice(0, 10);
}

/** The full learning report for a repo (first project repo by default). */
export async function learningReport(
  ctx: Ctx,
  input: { repoSlug?: string } = {},
): Promise<LearningReport> {
  const { repo, zones } = input.repoSlug
    ? await resolveRepo(ctx, input.repoSlug)
    : await firstProjectRepo(ctx);
  const merged = await ctx.stores.worksites.listMerged(repo.id);
  const accuracy = await accuracyOf(ctx, repo.id, merged);
  const proposals = await proposalsFor(ctx, repo.id, zones);
  const fourNumbers = await collisionStats(ctx, { repoSlug: repo.slug });
  return { accuracy, proposals, fourNumbers };
}

async function firstProjectRepo(ctx: Ctx) {
  const repos = await ctx.stores.repos.listByProject(ctx.projectId);
  const repo = repos[0];
  if (!repo) fail("repo-not-registered");
  const zones = await ctx.stores.zones.listByRepo(repo.id);
  return { repo, zones };
}
