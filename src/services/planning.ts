/**
 * services/planning — read-only planning tools (CC-11, CC-12, §12, §13).
 * JQL execution goes through ctx.jira.searchIssues (injected port); tests
 * and the simulation console supply a fake port.
 */

import { detectCollisions } from "../core/collisions";
import type { WorksiteWithEntries } from "../core/collisions";
import { predictFromHistory } from "../core/predict";
import { planWaves } from "../core/waves";
import { entriesOverlap, classifyPath } from "../core/paths";
import { isFrozen, zoneForPath } from "../core/zones";
import type {
  Collision,
  CollisionStats,
  FootprintSource,
  PlanTicket,
  SprintCheckData,
  TicketMeta,
  WavePlan,
  Zone,
} from "../core/types";
import type { Ctx } from "./ctx";
import { loadOpenWorksites, resolveRepo } from "./shared";

async function search(ctx: Ctx, jql: string): Promise<TicketMeta[]> {
  if (!ctx.jira?.searchIssues) {
    throw new Error("planning tools require Jira access (ctx.jira.searchIssues is missing)");
  }
  return ctx.jira.searchIssues(jql);
}

async function firstRepo(ctx: Ctx, repoSlug?: string) {
  if (repoSlug) return resolveRepo(ctx, repoSlug);
  const repos = await ctx.stores.repos.listByProject(ctx.projectId);
  const repo = repos[0];
  if (!repo) throw new Error("no repository registered for this project yet");
  const zones = await ctx.stores.zones.listByRepo(repo.id);
  return { repo, zones };
}

/** Declared/observed footprint of a ticket, else its stored/live prediction. */
export async function planTicketFor(
  ctx: Ctx,
  t: TicketMeta,
  repoId: string,
  repoSlug: string,
): Promise<PlanTicket> {
  const entries: PlanTicket["entries"] = [];
  for (const w of await ctx.stores.worksites.findByIssue(t.issueKey, repoId)) {
    for (const e of await ctx.stores.footprints.listByWorksite(w.id)) {
      entries.push({ path: e.path, kind: e.kind, source: e.source });
    }
  }
  if (entries.length === 0) {
    const stored = await ctx.stores.predictions.findByIssue(t.issueKey, repoId);
    for (const p of stored) {
      for (const e of p.entries) {
        entries.push({ path: e.path, kind: e.kind, source: "predicted" as FootprintSource });
      }
    }
  }
  if (entries.length === 0 && ctx.jira?.mergedHistory) {
    const history = await ctx.jira.mergedHistory(repoSlug).catch(() => []);
    for (const e of predictFromHistory(t, history).entries) {
      entries.push({ path: e.path, kind: e.kind, source: "predicted" });
    }
  }
  return {
    issueKey: t.issueKey,
    summary: t.summary,
    components: t.components,
    priorityRank: t.priorityRank,
    dueAt: t.dueAt,
    incident: t.incident,
    entries,
  };
}

/** Virtual worksites so detectCollisions can score ticket pairs. */
export function virtualSides(tickets: PlanTicket[], repoId: string): WorksiteWithEntries[] {
  const now = "1970-01-01T00:00:00.000Z";
  return tickets.map((t, i) => ({
    worksite: {
      id: `plan-${i}-${t.issueKey}`,
      issueKey: t.issueKey,
      repoId,
      accountId: `plan-${i}`,
      kind: "agent" as const,
      state: "planned" as const,
      openedAt: now,
      lastActivityAt: now,
    },
    entries: t.entries.map((e) => ({
      worksiteId: `plan-${i}-${t.issueKey}`,
      path: e.path,
      kind: e.kind,
      source: e.source,
      mode: "edit" as const,
      firstAt: now,
      lastAt: now,
    })),
  }));
}

/** Colliding pairs among the tickets matched by the JQL. */
export async function listCollisions(
  ctx: Ctx,
  input: { jql: string },
): Promise<Collision[]> {
  const tickets = await search(ctx, input.jql);
  const { repo } = await firstRepo(ctx);
  const zones = await ctx.stores.zones.listByRepo(repo.id);
  const plans: PlanTicket[] = [];
  for (const t of tickets) plans.push(await planTicketFor(ctx, t, repo.id, repo.slug));
  const sides = virtualSides(plans, repo.id);
  const now = ctx.now();
  const out: Collision[] = [];
  const seen = new Set<string>();
  for (const side of sides) {
    const drafts = detectCollisions(side, sides, {
      zones,
      reservations: [],
      now,
      hardMode: false,
    });
    for (const d of drafts) {
      if (d.degree < 1) continue; // planning cares about real risk, not D0
      const key = `${d.worksiteA}|${d.worksiteB}|${d.zoneId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...d, id: key, state: "open", detectedAt: now });
    }
  }
  return out;
}

/** Ready tickets nobody collides with — what an idle agent can start now. */
export async function listClearWork(
  ctx: Ctx,
  input: { jql: string; session?: string },
): Promise<TicketMeta[]> {
  void input.session;
  const tickets = await search(ctx, input.jql);
  let found;
  try {
    found = await firstRepo(ctx);
  } catch {
    // No repository registered for this project yet: nothing can collide.
    return tickets;
  }
  const { repo, zones } = found;
  const now = ctx.now();
  const open = await loadOpenWorksites(ctx, repo.id);
  const reservations = await ctx.stores.reservations.listActive(repo.id, now);
  const busyIssueKeys = new Set(open.map((o) => o.worksite.issueKey));

  const clear: TicketMeta[] = [];
  for (const t of tickets) {
    if (busyIssueKeys.has(t.issueKey)) continue; // someone is already on it
    const plan = await planTicketFor(ctx, t, repo.id, repo.slug);
    if (plan.entries.length === 0) {
      clear.push(t); // no footprint known: nothing to collide with
      continue;
    }
    const side = virtualSides([plan], repo.id)[0]!;
    const drafts = detectCollisions(side, open, {
      zones,
      reservations,
      now,
      hardMode: false,
    });
    const blocked = drafts.some((d) => d.degree >= 1);
    const frozen = plan.entries.some((e) => {
      const zone = zoneForPath(zones, e.path);
      return zone !== undefined && isFrozen(zone, now);
    });
    if (!blocked && !frozen) clear.push(t);
  }
  return clear;
}

/* ------------------------------------------------------------------ */
/* Dispatcher — "the next clear ticket for agent N" (spec §27 vision)   */
/* ------------------------------------------------------------------ */

export interface NextClearTicket {
  /** The ticket to start now; undefined when nothing is clear. */
  issueKey?: string;
  ticket?: TicketMeta;
  /** Always explains WHY (no anonymous answers — spec §8). */
  why: string;
  /** Up to two runners-up, in order. */
  alternatives: string[];
}

function ticketRank(t: TicketMeta): number {
  return t.priorityRank ?? Number.MAX_SAFE_INTEGER;
}

function dueRank(t: TicketMeta): number {
  return t.dueAt ? new Date(t.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * The dispatcher of spec §27: the orchestrator asks for "the next clear
 * ticket for this worker" instead of reading a whole list. Ranking:
 * ticket priority, then nearest due date, then issue key (stable).
 */
export async function nextClearTicket(
  ctx: Ctx,
  input: { jql: string; session?: string },
): Promise<NextClearTicket> {
  const clear = await listClearWork(ctx, input);
  if (clear.length === 0) {
    return {
      why: "no clear ticket in this selection right now — every candidate collides with an open worksite, sits in a frozen zone, or is already taken",
      alternatives: [],
    };
  }
  const ranked = clear
    .slice()
    .sort(
      (a, b) =>
        ticketRank(a) - ticketRank(b) ||
        dueRank(a) - dueRank(b) ||
        a.issueKey.localeCompare(b.issueKey),
    );
  const next = ranked[0]!;
  return {
    issueKey: next.issueKey,
    ticket: next,
    why: `no collision with any open worksite; next by priority among ${clear.length} clear ticket(s)`,
    alternatives: ranked.slice(1, 3).map((t) => t.issueKey),
  };
}

/** Collision-free waves for N workers (core/waves.planWaves). */
export async function planParallelWork(
  ctx: Ctx,
  input: { jql: string; workers: number },
): Promise<WavePlan> {
  const tickets = await search(ctx, input.jql);
  const { repo, zones } = await firstRepo(ctx);
  const plans: PlanTicket[] = [];
  for (const t of tickets) plans.push(await planTicketFor(ctx, t, repo.id, repo.slug));
  return planWaves(plans, Math.max(1, input.workers), { zones });
}

/** Score every ticket pair through the real detector; keep D2+ pairs. */
async function riskyPairsOf(
  plans: PlanTicket[],
  zones: Zone[],
  repoId: string,
  now: string,
): Promise<SprintCheckData["riskyPairs"]> {
  const sides = virtualSides(plans, repoId);
  const out: SprintCheckData["riskyPairs"] = [];
  const seen = new Set<string>();
  for (const side of sides) {
    for (const d of detectCollisions(side, sides, {
      zones,
      reservations: [],
      now,
      hardMode: false,
    })) {
      if (d.degree < 2) continue;
      const key = `${d.worksiteA}|${d.worksiteB}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = sides.find((s) => s.worksite.id === d.worksiteA);
      const b = sides.find((s) => s.worksite.id === d.worksiteB);
      out.push({
        a: a?.worksite.issueKey ?? d.worksiteA,
        b: b?.worksite.issueKey ?? d.worksiteB,
        degree: d.degree,
        path: d.path,
        zoneName: zones.find((z) => z.id === d.zoneId)?.name,
      });
    }
  }
  return out;
}

/** Sprint verification: risky pairs, hinges, suggested order (CC-19). */
export async function sprintCheck(
  ctx: Ctx,
  issueKeys: string[],
): Promise<SprintCheckData> {
  if (issueKeys.length === 0) {
    return {
      tickets: [],
      riskyPairs: [],
      hinges: [],
      suggestedOrder: [],
      confidence: "high",
    };
  }
  const tickets = await search(ctx, `issue in (${issueKeys.join(",")})`);
  const { repo, zones } = await firstRepo(ctx);
  const plans: PlanTicket[] = [];
  for (const t of tickets) plans.push(await planTicketFor(ctx, t, repo.id, repo.slug));

  const riskyPairs = await riskyPairsOf(plans, zones, repo.id, ctx.now());
  const plan = planWaves(plans, Math.max(plans.length, 1), { zones });
  return {
    tickets: plans,
    riskyPairs,
    hinges: plan.hinges,
    suggestedOrder: plan.waves.flat(),
    confidence: plan.confidence,
    confidenceNote: plan.confidenceNote,
  };
}

/** The four numbers of spec §13 (missedUntilMerge comes from real conflicts). */
export async function collisionStats(
  ctx: Ctx,
  input?: { repoSlug?: string; since?: string },
): Promise<CollisionStats> {
  const { repo } = await firstRepo(ctx, input?.repoSlug);
  const counts = await ctx.stores.collisions.countByPhase(repo.id, input?.since);
  const conflicts = await ctx.stores.conflicts.list(repo.id, input?.since);
  return {
    seenBeforeCode: counts["before-code"] ?? 0,
    seenWhileWorking: counts["live"] ?? 0,
    seenAtPr: counts["pr"] ?? 0,
    missedUntilMerge: conflicts.filter((c) => !c.wasDetected).length,
  };
}

/** Overlap utility re-exported for the glue (kept local to planning). */
export function pathsCollide(a: string, b: string): boolean {
  return entriesOverlap(a, classifyPath(a), b, classifyPath(b));
}
