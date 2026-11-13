/**
 * glue/demo — PUBLIC demo routes over the REAL deployment.
 *
 * The judge opens the static site and must see the app ACTUALLY working:
 * the real worksites, the real collisions, the real verdict for a path.
 * These routes answer without a token, so they are strictly limited:
 *
 *  - only the repositories of DEMO_REPOS (today: the demo repo acme/billing,
 *    which holds synthetic data) — any other repository answers 403;
 *  - only what the demo needs (states, degrees, paths of the DEMO repo);
 *  - CORS is open so the static site can read them.
 *
 * A customer repository can never be exposed by accident: the allow-list is
 * code, not configuration.
 */

import type { Ctx } from "../services/ctx";
import type { Verdict } from "../core/types";
import { checkZone } from "../services/declare";

/** The only repositories the public demo routes may talk about. */
export const DEMO_REPOS = ["acme/billing"];

export interface DemoWorksite {
  issueKey: string;
  state: string;
  kind: string;
  branch?: string;
  paths: string[];
  lastActivityAt: string;
}

export interface DemoCollision {
  issueKeyA: string;
  issueKeyB: string;
  degree: number;
  path: string;
  zoneName?: string;
}

export interface DemoState {
  ok: true;
  generatedAt: string;
  repo: string;
  worksites: DemoWorksite[];
  collisions: DemoCollision[];
}

/** The demo repo record (and its project bucket), or undefined. */
async function demoRepo(ctx: Ctx, slug: string) {
  if (!DEMO_REPOS.includes(slug)) return undefined;
  const repos = await ctx.stores.repos.listAll();
  const repo = repos.find((r) => r.slug === slug);
  if (repo === undefined) return undefined;
  return { repo, ctx: { ...ctx, projectId: repo.projectId } as Ctx };
}

/** How many collisions the public demo route returns (the site shows 8). */
export const DEMO_MAX_COLLISIONS = 24;

/**
 * Live state of the demo repository: worksites and open collisions.
 *
 * FOUR queries, whatever the volume of the repo:
 *   1. the open worksites,
 *   2. their footprints — ONE indexed query on (repo_id),
 *   3. the open collisions, capped to the worst ones,
 *   4. the worksites those collisions point to — ONE `IN` query.
 *
 * It used to resolve two worksites per collision (and one footprint list per
 * worksite): on the demo repo that is ~4 500 round trips, and the deployment
 * answered "424 Failed Dependency" — the resolver timed out before the
 * verdict was ready. The demo must answer in seconds, not minutes.
 */
export async function demoState(ctx: Ctx, slug: string): Promise<DemoState | undefined> {
  const found = await demoRepo(ctx, slug);
  if (found === undefined) return undefined;
  const { repo, ctx: scoped } = found;

  const openWorksites = await scoped.stores.worksites.listOpenByRepo(repo.id);

  const pathsByWorksite = new Map<string, string[]>();
  for (const entry of await scoped.stores.footprints.listByRepo(repo.id)) {
    const paths = pathsByWorksite.get(entry.worksiteId);
    if (paths === undefined) pathsByWorksite.set(entry.worksiteId, [entry.path]);
    else paths.push(entry.path);
  }
  const worksites: DemoWorksite[] = openWorksites.map((w) => ({
    issueKey: w.issueKey,
    state: w.state,
    kind: w.kind,
    branch: w.branch,
    paths: pathsByWorksite.get(w.id) ?? [],
    lastActivityAt: w.lastActivityAt,
  }));

  const worst = (await scoped.stores.collisions.listByRepo(repo.id, true))
    .slice()
    .sort((a, b) => b.degree - a.degree)
    .slice(0, DEMO_MAX_COLLISIONS);
  const wanted = [...new Set(worst.flatMap((c) => [c.worksiteA, c.worksiteB]))];
  const byId = new Map((await scoped.stores.worksites.findByIds(wanted)).map((w) => [w.id, w]));
  const collisions: DemoCollision[] = [];
  for (const c of worst) {
    const a = byId.get(c.worksiteA);
    const b = byId.get(c.worksiteB);
    if (a === undefined || b === undefined) continue;
    collisions.push({
      issueKeyA: a.issueKey,
      issueKeyB: b.issueKey,
      degree: c.degree,
      path: c.path,
    });
  }
  return {
    ok: true,
    generatedAt: scoped.now(),
    repo: repo.slug,
    worksites,
    collisions,
  };
}

/**
 * The real verdict for a path, computed against the live worksites of the
 * demo repository. No state is written: this is a probe (check-zone), not a
 * declaration.
 */
export async function demoVerdict(
  ctx: Ctx,
  slug: string,
  paths: string,
  issueKey?: string,
): Promise<{ verdict: Verdict; state: DemoState } | undefined> {
  const found = await demoRepo(ctx, slug);
  if (found === undefined) return undefined;
  const { repo, ctx: scoped } = found;
  const verdict = await checkZone(scoped, { repoSlug: repo.slug, paths, issueKey });
  const state = await demoState(scoped, repo.slug);
  if (state === undefined) return undefined;
  return { verdict, state };
}
