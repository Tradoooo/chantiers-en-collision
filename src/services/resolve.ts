/**
 * services/resolve — the six outcomes of a collision (CC-20, spec §8).
 * wait/sequence use "who yields" (core/priority); coordinate sends a notice
 * to the neighbour; split prepares a draft ticket; override requires a
 * reason and is watched against later real conflicts.
 */

import { advanceOf, whoYields } from "../core/priority";
import type {
  ResolutionChoice,
  ResolutionOutcome,
  Worksite,
  YieldContext,
} from "../core/types";
import type { Ctx } from "./ctx";
import { logEvent, rulesFor } from "./shared";

export interface ResolveInput {
  collisionId: string;
  choice: ResolutionChoice;
  reason?: string;
}

async function yieldContext(ctx: Ctx, w: Worksite): Promise<YieldContext> {
  const now = ctx.now();
  const reservations = await ctx.stores.reservations.listByWorksite(w.id, now);
  return {
    worksiteId: w.id,
    kind: w.kind,
    hasActiveReservation: reservations.some((r) => !r.releasedAt && r.expiresAt > now),
    incident: w.ticket?.incident ?? false,
    priorityRank: w.ticket?.priorityRank,
    dueAt: w.ticket?.dueAt,
    advance: advanceOf(w.state, w.prOpen),
    arrivedAt: w.openedAt,
  };
}

/** The caller's side of the collision when identifiable, else side A. */
function callerSide(ctx: Ctx, a: Worksite, b: Worksite): [Worksite, Worksite] {
  if (a.accountId === ctx.identity.accountId) return [a, b];
  if (b.accountId === ctx.identity.accountId) return [b, a];
  return [a, b];
}

export async function resolveCollision(
  ctx: Ctx,
  input: ResolveInput,
): Promise<ResolutionOutcome> {
  const collision = await ctx.stores.collisions.findById(input.collisionId);
  if (!collision) throw new Error(`resolve-collision: unknown collision ${input.collisionId}`);
  if (collision.state !== "open") {
    return { collisionId: collision.id, choice: input.choice, recorded: false };
  }
  if (input.choice === "override" && !input.reason) {
    throw new Error("resolve-collision: override requires a reason");
  }

  const wa = await ctx.stores.worksites.findById(collision.worksiteA);
  const wb = await ctx.stores.worksites.findById(collision.worksiteB);
  if (!wa || !wb) throw new Error("resolve-collision: worksite of the collision is gone");

  const outcome: ResolutionOutcome = {
    collisionId: collision.id,
    choice: input.choice,
    recorded: true,
  };

  if (input.choice === "wait" || input.choice === "sequence") {
    const rules = await rulesFor(ctx);
    const [ya, yb] = await Promise.all([yieldContext(ctx, wa), yieldContext(ctx, wb)]);
    const yields = whoYields(ya, yb, rules) === "a" ? wa : wb;
    const blocker = yields.id === wa.id ? wb : wa;
    outcome.yieldsWorksiteId = yields.id;
    if (input.choice === "sequence") {
      outcome.linkToCreate = {
        blockedIssueKey: yields.issueKey,
        blockerIssueKey: blocker.issueKey,
      };
      if (ctx.jira) {
        await ctx.jira
          .createIssueLink(yields.issueKey, blocker.issueKey)
          .catch(() => undefined);
      }
    }
  }

  if (input.choice === "coordinate") {
    const [mine, other] = callerSide(ctx, wa, wb);
    await ctx.stores.notices.post(
      {
        worksiteId: mine.id,
        repoId: collision.repoId,
        authorAccountId: ctx.identity.accountId,
        issueKey: mine.issueKey,
        paths: [collision.path],
        text: `Let's coordinate on ${collision.path} (D${collision.degree}).${
          input.reason ? ` ${input.reason}` : ""
        }`,
        createdAt: ctx.now(),
      },
      [other.id],
    );
    outcome.noticeSent = true;
  }

  if (input.choice === "split") {
    outcome.splitTicketDraft = {
      summary: `Extract shared change: ${collision.path}`,
      description: [
        `Split from the collision between ${wa.issueKey} and ${wb.issueKey}.`,
        `The common part (${collision.path}) is done here, first, then both continue.`,
        input.reason ? `Reason: ${input.reason}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      paths: [collision.path],
    };
  }

  // "merge": same file, same goal — one worksite does both; recording the
  // choice is enough, the team closes the duplicate ticket by hand.

  await ctx.stores.collisions.resolve(
    collision.id,
    input.choice,
    ctx.identity.accountId,
    input.reason,
  );
  await logEvent(ctx, "collision.resolved", undefined, {
    collisionId: collision.id,
    choice: input.choice,
  });
  return outcome;
}
