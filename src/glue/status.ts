/**
 * glue/status — read-only observability of a deployment, served by the
 * web trigger route `/status` (token required). Lets the smoke test and the
 * operator answer: did the triggers/hooks/CI actually create worksites,
 * collisions and reservations in Forge SQL?
 */

import type { Ctx } from "../services/ctx";
import { repoIdsOfWorksites } from "./discovery";

export interface StatusWorksite {
  issueKey: string;
  state: string;
  kind: string;
  branch?: string;
  lastActivityAt: string;
}

export interface StatusRepo {
  slug: string;
  openWorksites: number;
  openCollisions: number;
  activeReservations: number;
}

export interface StatusReport {
  generatedAt: string;
  repos: StatusRepo[];
  worksites: StatusWorksite[];
  recentEvents: { at: string; kind: string }[];
}

/** One line per repository the installation knows about. */
async function repoStatus(ctx: Ctx, repoId: string): Promise<StatusRepo> {
  const repo = await ctx.stores.repos.findById(repoId);
  const now = ctx.now();
  const [open, collisions, reservations] = await Promise.all([
    ctx.stores.worksites.listOpenByRepo(repoId),
    ctx.stores.collisions.listByRepo(repoId, true),
    ctx.stores.reservations.listActive(repoId, now),
  ]);
  return {
    slug: repo?.slug ?? repoId,
    openWorksites: open.length,
    openCollisions: collisions.length,
    activeReservations: reservations.length,
  };
}

export async function deploymentStatus(ctx: Ctx): Promise<StatusReport> {
  const ids = new Set<string>(await repoIdsOfWorksites(ctx));
  for (const repo of await ctx.stores.repos.listByProject(ctx.projectId)) {
    ids.add(repo.id);
  }
  const repos: StatusRepo[] = [];
  const worksites: StatusWorksite[] = [];
  for (const repoId of ids) {
    repos.push(await repoStatus(ctx, repoId));
    for (const w of await ctx.stores.worksites.listOpenByRepo(repoId)) {
      if (worksites.length >= 50) break;
      worksites.push({
        issueKey: w.issueKey,
        state: w.state,
        kind: w.kind,
        branch: w.branch,
        lastActivityAt: w.lastActivityAt,
      });
    }
  }
  const recentEvents = (await ctx.stores.events.recent(10)).map((e) => ({
    at: e.at,
    kind: e.kind,
  }));
  return { generatedAt: ctx.now(), repos, worksites, recentEvents };
}
