/**
 * services/width — the parallel width of a repository (spec §27 vision):
 * "this repo supports N agents at once; splitting X would let N+k work."
 *
 * Width = the largest collision-free wave obtainable from the tickets'
 * footprints (planWaves with workers = ticketCount). Bottlenecks = the
 * zones/paths carrying the most D2+ links. The suggestion simulates the
 * split of the top bottleneck and recomputes the width.
 */

import { detectCollisions } from "../core/collisions";
import { classifyPath } from "../core/paths";
import { planWaves } from "../core/waves";
import type { PlanTicket, Zone } from "../core/types";
import type { Ctx } from "./ctx";
import { loadOpenWorksites, projectIdOfIssueKey, resolveRepo } from "./shared";
import { asStructural, planTicketFor, virtualSides } from "./planning";

export type { ParallelWidthReport, WidthBottleneck } from "../core/types";
import type { ParallelWidthReport, WidthBottleneck } from "../core/types";

interface Edge {
  a: string;
  b: string;
  path: string;
  zoneName?: string;
}

/* ------------------------------------------------------------------ */
/* Ticket sourcing                                                     */
/* ------------------------------------------------------------------ */

/** Tickets of a JQL selection, with footprints (declared, stored or live). */
async function ticketsFromJql(
  ctx: Ctx,
  jql: string,
  repoId: string,
  repoSlug: string,
): Promise<PlanTicket[]> {
  if (!ctx.jira?.searchIssues) {
    throw new Error("measure-parallel-width: jql requires the Jira port (ctx.jira.searchIssues)");
  }
  const tickets = await ctx.jira.searchIssues(jql);
  const out: PlanTicket[] = [];
  for (const t of tickets) out.push(await planTicketFor(ctx, t, repoId, repoSlug));
  return out;
}

/** Representative tickets from the merged history (no JQL given). */
async function ticketsFromHistory(ctx: Ctx, repoSlug: string): Promise<PlanTicket[]> {
  if (!ctx.jira?.mergedHistory) return [];
  const history = await ctx.jira.mergedHistory(repoSlug).catch(() => []);
  return history.slice(0, 30).map((h) => ({
    issueKey: h.issueKey,
    components: h.components,
    summary: h.summary,
    entries: h.paths.map((p) => ({ path: p, kind: classifyPath(p), source: "attested" as const })),
  }));
}

/** Fallback: the open worksites of the repo, as they are. */
async function ticketsFromOpenWorksites(ctx: Ctx, repoId: string): Promise<PlanTicket[]> {
  const open = await loadOpenWorksites(ctx, repoId);
  const out: PlanTicket[] = [];
  for (const side of open) {
    out.push({
      issueKey: side.worksite.issueKey,
      components: side.worksite.ticket?.components ?? [],
      entries: side.entries.map((e) => ({ path: e.path, kind: e.kind, source: e.source })),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Graph, width, bottlenecks                                           */
/* ------------------------------------------------------------------ */

/** D2+ links between tickets (hotspot-lowered D0/D1 are not walls). */
function edgesOf(tickets: PlanTicket[], zones: Zone[], repoId: string, now: string): Edge[] {
  const sides = virtualSides(asStructural(tickets), repoId);
  const byId = new Map(sides.map((s) => [s.worksite.id, s.worksite.issueKey]));
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const side of sides) {
    for (const d of detectCollisions(side, sides, {
      zones,
      reservations: [],
      now,
      hardMode: false,
    })) {
      if (d.degree < 2) continue;
      const key = `${d.worksiteA}|${d.worksiteB}|${d.zoneId ?? d.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        a: byId.get(d.worksiteA) ?? d.worksiteA,
        b: byId.get(d.worksiteB) ?? d.worksiteB,
        path: d.path,
        zoneName: zones.find((z) => z.id === d.zoneId)?.name,
      });
    }
  }
  return edges;
}

/** Largest wave of an unconstrained plan = the parallel width. */
function widthOf(tickets: PlanTicket[], zones: Zone[]): number {
  if (tickets.length === 0) return 0;
  const plan = planWaves(tickets, tickets.length, { zones });
  return plan.waves.reduce((max, wave) => Math.max(max, wave.length), 0);
}

function bottlenecksOf(edges: Edge[]): WidthBottleneck[] {
  const counts = new Map<string, WidthBottleneck>();
  for (const e of edges) {
    const label = e.zoneName ?? e.path;
    const current = counts.get(label) ?? {
      label,
      zoneName: e.zoneName,
      path: e.zoneName ? undefined : e.path,
      edges: 0,
    };
    current.edges += 1;
    counts.set(label, current);
  }
  return [...counts.values()].sort((x, y) => y.edges - x.edges).slice(0, 3);
}

/** Recompute the width as if the bottleneck were split away. */
function widthAfterSplit(
  tickets: PlanTicket[],
  zones: Zone[],
  bottleneck: WidthBottleneck,
): number {
  if (bottleneck.zoneName) {
    // The zone stops being a wall (e.g. per-area migration folders).
    return widthOf(tickets, zones.filter((z) => z.name !== bottleneck.zoneName));
  }
  // A single shared file: simulate one file per area (path disappears).
  const stripped = tickets.map((t) => ({
    ...t,
    entries: t.entries.filter((e) => e.path !== bottleneck.path),
  }));
  return widthOf(stripped, zones);
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

function confidenceOf(tickets: PlanTicket[]): {
  confidence: ParallelWidthReport["confidence"];
  note?: string;
} {
  if (tickets.length === 0) return { confidence: "low", note: "no ticket to measure" };
  const blind = tickets.filter((t) => t.entries.length === 0).length;
  const share = blind / tickets.length;
  if (share > 0.5) {
    return { confidence: "low", note: `${blind} of ${tickets.length} tickets have no footprint` };
  }
  if (share > 0.25) {
    return { confidence: "medium", note: `${blind} of ${tickets.length} tickets have no footprint` };
  }
  return { confidence: "high" };
}

export async function measureParallelWidth(
  ctx: Ctx,
  input: { jql?: string; repoSlug?: string } = {},
): Promise<ParallelWidthReport> {
  let jqlTickets: PlanTicket["issueKey"][] = [];
  if (input.jql) {
    if (!ctx.jira?.searchIssues) {
      throw new Error("measure-parallel-width: jql requires the Jira port");
    }
    jqlTickets = (await ctx.jira.searchIssues(input.jql)).map((t) => t.issueKey);
  }
  const firstKey = jqlTickets[0];
  const pid = firstKey === undefined ? undefined : projectIdOfIssueKey(firstKey);
  const { repo, zones } = await resolveRepoOrFirst(ctx, input.repoSlug, pid);
  let tickets: PlanTicket[] = [];
  if (input.jql) tickets = await ticketsFromJql(ctx, input.jql, repo.id, repo.slug);
  if (tickets.length === 0 && !input.jql) tickets = await ticketsFromHistory(ctx, repo.slug);
  if (tickets.length === 0 && !input.jql) tickets = await ticketsFromOpenWorksites(ctx, repo.id);

  const width = widthOf(tickets, zones);
  const edges = edgesOf(tickets, zones, repo.id, ctx.now());
  const bottlenecks = bottlenecksOf(edges);
  const { confidence, note } = confidenceOf(tickets);

  let suggestion: ParallelWidthReport["suggestion"];
  const top = bottlenecks[0];
  if (top) {
    const widthAfter = widthAfterSplit(tickets, zones, top);
    if (widthAfter > width) {
      suggestion = {
        split: top.zoneName
          ? `split the "${top.zoneName}" zone into per-area parts`
          : `split ${top.path} into per-area files`,
        widthAfter,
        delta: widthAfter - width,
      };
    }
  }
  return { width, ticketCount: tickets.length, bottlenecks, suggestion, confidence, note };
}

async function resolveRepoOrFirst(
  ctx: Ctx,
  repoSlug?: string,
  projectId?: string,
) {
  if (repoSlug) return resolveRepo(ctx, repoSlug);
  const pid = projectId ?? ctx.projectId;
  const repos = await ctx.stores.repos.listByProject(pid);
  const repo = repos[0];
  if (!repo) {
    throw new Error(
      "no repository registered — pass repoSlug, or a jql whose tickets reveal the project",
    );
  }
  const zones = await ctx.stores.zones.listByRepo(repo.id);
  return { repo, zones };
}
