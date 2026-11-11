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

export async function postNotice(
  ctx: Ctx,
  input: PostNoticeInput,
): Promise<{ notice: Notice; recipients: NeighborInfo[] }> {
  const now = ctx.now();
  const paths = splitPathsBlock(input.paths);
  if (paths.length === 0) throw new Error("post-notice: at least one path is required");
  if (input.text.trim() === "") throw new Error("post-notice: text is required");

  let { repoIds, authorWorksiteId } = await repoIdsForNotice(ctx, input);

  // A human can warn from the ticket panel without a worksite yet (spec
  // §9.4): open one so the notice has an author and a ticket anchor.
  if (repoIds.length === 0 && input.repoSlug) {
    const { repo } = await resolveRepo(ctx, input.repoSlug);
    const w = await ensureWorksite(ctx, { issueKey: input.issueKey, repoId: repo.id });
    repoIds = [repo.id];
    authorWorksiteId = w.id;
  }
  if (repoIds.length === 0) {
    throw new Error(`post-notice: no worksite or repo for ${input.issueKey}`);
  }

  const recipients: NeighborInfo[] = [];
  let notice: Notice | undefined;
  for (const repoId of repoIds) {
    const open = await loadOpenWorksites(ctx, repoId);
    const targets = open.filter(
      (side) =>
        side.worksite.id !== authorWorksiteId &&
        side.entries.some((e) =>
          paths.some((p) => entriesOverlap(e.path, e.kind, p, classifyPath(p))),
        ),
    );
    const candidate = {
      worksiteId: authorWorksiteId ?? "",
      repoId,
      authorAccountId: ctx.identity.accountId,
      issueKey: input.issueKey,
      paths,
      text: input.text,
      createdAt: now,
    };
    const posted = await ctx.stores.notices.post(
      candidate,
      targets.map((t) => t.worksite.id),
    );
    notice = notice ?? posted;
    for (const t of targets) {
      recipients.push(await buildNeighborInfo(ctx, t.worksite, "en"));
    }
  }
  await logEvent(ctx, "notice.posted", authorWorksiteId, {
    paths,
    recipients: recipients.length,
  });
  if (!notice) throw new Error("post-notice: nothing posted");
  return { notice, recipients };
}
