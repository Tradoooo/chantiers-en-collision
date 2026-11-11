/**
 * services/notices — the worksite mailbox (CC-08, spec §9.4).
 * Recipients = open worksites of the repo whose footprint overlaps the
 * notice paths (excluding the author's worksite). Delivered ONCE per
 * session, with the next tool response or hook context.
 */

import { entriesOverlap, classifyPath } from "../core/paths";
import type { NeighborInfo, Notice } from "../core/types";
import type { Ctx } from "./ctx";
import {
  buildNeighborInfo,
  ensureWorksite,
  loadOpenWorksites,
  logEvent,
  resolveRepo,
  splitPathsBlock,
} from "./shared";

export interface PostNoticeInput {
  issueKey: string;
  /** One path per line. */
  paths: string;
  text: string;
  repoSlug?: string;
}

/** Repos to broadcast on: the ticket's worksite repos, or the explicit slug. */
async function repoIdsForNotice(
  ctx: Ctx,
  input: PostNoticeInput,
): Promise<{ repoIds: string[]; authorWorksiteId?: string }> {
  if (input.repoSlug) {
    const { repo } = await resolveRepo(ctx, input.repoSlug);
    const mine = await ctx.stores.worksites.findByIssue(input.issueKey, repo.id);
    return { repoIds: [repo.id], authorWorksiteId: mine[0]?.id };
  }
  const worksites = await ctx.stores.worksites.findByIssue(input.issueKey);
  const repoIds = [...new Set(worksites.map((w) => w.repoId))];
  return { repoIds, authorWorksiteId: worksites[0]?.id };
}

/** Open worksites of a repo whose footprint overlaps the notice paths. */
async function findRecipients(
  ctx: Ctx,
  repoId: string,
  authorWorksiteId: string | undefined,
  paths: string[],
): Promise<NeighborInfo[]> {
  const open = await loadOpenWorksites(ctx, repoId);
  const targets = open.filter(
    (side) =>
      side.worksite.id !== authorWorksiteId &&
      side.entries.some((e) =>
        paths.some((p) => entriesOverlap(e.path, e.kind, p, classifyPath(p))),
      ),
  );
  const out: NeighborInfo[] = [];
  for (const t of targets) out.push(await buildNeighborInfo(ctx, t.worksite, "en"));
  return out;
}

/** Author of the notice: existing worksite of the ticket, or a fresh one
 *  (a human can warn from the ticket panel without a worksite — spec §9.4). */
async function authorOf(
  ctx: Ctx,
  input: PostNoticeInput,
): Promise<{ repoIds: string[]; authorWorksiteId?: string }> {
  const found = await repoIdsForNotice(ctx, input);
  if (found.repoIds.length > 0 || !input.repoSlug) return found;
  const { repo } = await resolveRepo(ctx, input.repoSlug);
  const w = await ensureWorksite(ctx, { issueKey: input.issueKey, repoId: repo.id });
  return { repoIds: [repo.id], authorWorksiteId: w.id };
}

export async function postNotice(
  ctx: Ctx,
  input: PostNoticeInput,
): Promise<{ notice: Notice; recipients: NeighborInfo[] }> {
  const paths = splitPathsBlock(input.paths);
  if (paths.length === 0) throw new Error("post-notice: at least one path is required");
  if (input.text.trim() === "") throw new Error("post-notice: text is required");

  const { repoIds, authorWorksiteId } = await authorOf(ctx, input);
  if (repoIds.length === 0) {
    throw new Error(`post-notice: no worksite or repo for ${input.issueKey}`);
  }

  const recipients: NeighborInfo[] = [];
  let notice: Notice | undefined;
  for (const repoId of repoIds) {
    const targets = await findRecipients(ctx, repoId, authorWorksiteId, paths);
    const posted = await ctx.stores.notices.post(
      {
        worksiteId: authorWorksiteId ?? "",
        repoId,
        authorAccountId: ctx.identity.accountId,
        issueKey: input.issueKey,
        paths,
        text: input.text,
        createdAt: ctx.now(),
      },
      targets.map((t) => t.worksiteId),
    );
    notice = notice ?? posted;
    recipients.push(...targets);
  }
  await logEvent(ctx, "notice.posted", authorWorksiteId, {
    paths,
    recipients: recipients.length,
  });
  if (!notice) throw new Error("post-notice: nothing posted");
  return { notice, recipients };
}
