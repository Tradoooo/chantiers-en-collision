/**
 * glue/discovery — "what exists in this installation?" helpers.
 * Owner: workstream I (glue). Used by the MCP tools, the triggers and the JQL
 * functions, so the logic exists ONCE.
 *
 * WHY THIS FILE EXISTS (reported gap): `Stores` has no "list projects", no
 * "list repositories" and no "list every worksite" — the only global listings
 * are `worksites.listIdleBefore(before)` (non-closed, NOT dormant, strictly
 * idle before `before`) and `worksites.listDormantBefore(before)` (dormant
 * only). Scanning both with a far-future bound therefore yields every
 * non-closed worksite of the installation, in both store implementations.
 * A `WorksiteStore.listByRepo(repoId, { includeClosed })` or a
 * `RepoStore.listAll()` would make this file unnecessary — see the report.
 *
 * Everything here is READ-ONLY and bounded (a scan, not a full table walk per
 * row): the callers cap what they do with the result.
 */

import type { Worksite } from "../core/types";
import type { Ctx } from "../services/ctx";
import { normalizeSlug } from "../services/shared";
import { DEFAULT_PROJECT_ID, projectOfIssueKey } from "../forge-context";

/** Upper bound for the "idle before" scans: everything not closed yet. */
export const FAR_FUTURE = "9999-12-31T23:59:59.999Z";

/** Every non-closed worksite of the installation (idle + dormant). */
export async function allNonClosedWorksites(ctx: Ctx): Promise<Worksite[]> {
  const [idle, dormant] = await Promise.all([
    ctx.stores.worksites.listIdleBefore(FAR_FUTURE),
    ctx.stores.worksites.listDormantBefore(FAR_FUTURE),
  ]);
  const byId = new Map<string, Worksite>();
  for (const worksite of [...idle, ...dormant]) byId.set(worksite.id, worksite);
  return [...byId.values()];
}

/** Project keys in use, derived from the issue keys on the ground. */
export async function projectIdsOfWorksites(ctx: Ctx, limit = 20): Promise<string[]> {
  const ids = new Set<string>();
  for (const worksite of await allNonClosedWorksites(ctx)) {
    const projectId = projectOfIssueKey(worksite.issueKey);
    if (projectId !== undefined) ids.add(projectId);
  }
  if (ids.size === 0) ids.add(DEFAULT_PROJECT_ID);
  return [...ids].slice(0, limit);
}

/** Repository ids with at least one non-closed worksite. */
export async function repoIdsOfWorksites(ctx: Ctx): Promise<string[]> {
  const ids = new Set<string>();
  for (const worksite of await allNonClosedWorksites(ctx)) ids.add(worksite.repoId);
  return [...ids];
}

/**
 * The project a repository slug belongs to, or undefined when no worksite uses
 * it yet. First match wins: a caller can always disambiguate with an issueKey
 * (or the platform's own project context, which takes precedence).
 */
export async function projectOfRepoSlug(ctx: Ctx, slug: string): Promise<string | undefined> {
  const wanted = normalizeSlug(slug);
  for (const repoId of await repoIdsOfWorksites(ctx)) {
    const repo = await ctx.stores.repos.findById(repoId);
    if (repo !== undefined && normalizeSlug(repo.slug) === wanted) return repo.projectId;
  }
  return undefined;
}
