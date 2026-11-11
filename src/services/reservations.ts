/**
 * services/reservations — bounded exclusive reservations (CC-07).
 * Nothing eternal: default 2 h, max 24 h (core/lifecycle), refused with a
 * reason when another active reservation overlaps.
 */

import { reservationExpiry } from "../core/lifecycle";
import type { Reservation, ReservationResult } from "../core/types";
import type { Ctx } from "./ctx";
import { ensureWorksite, logEvent, resolveRepo, rulesFor, splitPathsBlock } from "./shared";

export interface ReserveInput {
  issueKey: string;
  repoSlug: string;
  /** One path per line (patterns allowed). */
  paths: string;
  minutes?: number;
  reason?: string;
  /** Hard: the hook denies edits inside (project hardMode required). */
  hard?: boolean;
}

export async function reserveZone(
  ctx: Ctx,
  input: ReserveInput,
): Promise<ReservationResult> {
  const now = ctx.now();
  const patterns = splitPathsBlock(input.paths);
  if (patterns.length === 0) {
    return { refused: true, reason: "reserve-zone: at least one path is required" };
  }
  const { repo } = await resolveRepo(ctx, input.repoSlug);
  const rules = await rulesFor(ctx);
  const w = await ensureWorksite(ctx, {
    issueKey: input.issueKey,
    repoId: repo.id,
    sessionRef: ctx.identity.sessionRef,
  });

  const active = await ctx.stores.reservations.findActiveOverlapping(repo.id, patterns, now);
  const foreign = active.find((r) => r.worksiteId !== w.id);
  if (foreign) {
    const owner = await ctx.stores.worksites.findById(foreign.worksiteId);
    return {
      refused: true,
      reason: `already reserved by ${owner?.issueKey ?? foreign.worksiteId} until ${foreign.expiresAt}`,
      conflicting: foreign,
    };
  }

  const reservation: Reservation = await ctx.stores.reservations.create({
    worksiteId: w.id,
    repoId: repo.id,
    patterns,
    hard: (input.hard ?? false) && rules.hardMode,
    reason: input.reason,
    createdAt: now,
    expiresAt: reservationExpiry(now, input.minutes),
  });
  await logEvent(ctx, "reservation.created", w.id, {
    patterns,
    expiresAt: reservation.expiresAt,
    hard: reservation.hard,
  });
  return reservation;
}

export async function releaseReservation(ctx: Ctx, id: string): Promise<boolean> {
  const released = await ctx.stores.reservations.release(id, ctx.now());
  if (released) await logEvent(ctx, "reservation.released", undefined, { id });
  return released;
}
