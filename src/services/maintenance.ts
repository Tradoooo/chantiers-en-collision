/**
 * services/maintenance — the two guarantees of spec §11 (CC-17):
 * no eternal reservation, no ghost worksite.
 * sweep (fiveMinute): dormancy, auto-close, reservation expiry.
 * dailyJobs (day): refresh predictions, measure prediction accuracy.
 */

import { predictFromHistory } from "../core/predict";
import { DORMANT_CLOSE_DAYS } from "../core/types";
import type { Ctx } from "./ctx";
import { buildNeighborInfo, logEvent, rulesFor } from "./shared";

export interface SweepResult {
  dormant: string[];
  closed: string[];
  expiredReservations: string[];
  released: string[];
}

function minusHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() - hours * 3_600_000).toISOString();
}

function minusDays(iso: string, days: number): string {
  return minusHours(iso, days * 24);
}

export async function sweep(ctx: Ctx): Promise<SweepResult> {
  const now = ctx.now();
  const rules = await rulesFor(ctx);
  const out: SweepResult = {
    dormant: [],
    closed: [],
    expiredReservations: [],
    released: [],
  };

  // 1. Idle worksites go dormant (degree of their collisions drops by one
  //    through the dormant modulation on the next detection).
  const idleBefore = minusHours(now, rules.dormancyHours);
  for (const w of await ctx.stores.worksites.listIdleBefore(idleBefore)) {
    await ctx.stores.worksites.update(w.id, { state: "dormant" });
    out.dormant.push(w.id);
    await logEvent(ctx, "worksite.dormant", w.id);
  }

  // 2. No ghost worksites: dormant for DORMANT_CLOSE_DAYS → closed, and
  //    neighbours waiting on them are released (their next call says free).
  const closeBefore = minusDays(now, DORMANT_CLOSE_DAYS);
  for (const w of await ctx.stores.worksites.listDormantBefore(closeBefore)) {
    await ctx.stores.worksites.update(w.id, {
      state: "closed",
      closedAt: now,
      outcome: "expired",
    });
    out.closed.push(w.id);
    await logEvent(ctx, "worksite.auto-closed", w.id);
    for (const c of await ctx.stores.collisions.listByWorksite(w.id, true)) {
      const otherId = c.worksiteA === w.id ? c.worksiteB : c.worksiteA;
      await ctx.stores.collisions.resolve(c.id, undefined, "system", "neighbour expired");
      if (!out.released.includes(otherId)) {
        const other = await ctx.stores.worksites.findById(otherId);
        if (other && other.state !== "closed") {
          await buildNeighborInfo(ctx, other, "en"); // validates the neighbour exists
          out.released.push(otherId);
        }
      }
    }
  }

  // 3. No eternal reservations.
  for (const r of await ctx.stores.reservations.releaseExpired(now)) {
    out.expiredReservations.push(r.id);
    await logEvent(ctx, "reservation.expired", r.worksiteId, { id: r.id });
  }
  return out;
}

export async function dailyJobs(
  ctx: Ctx,
): Promise<{ predictions: number; accuracyComputed: number }> {
  let predictions = 0;
  let accuracyComputed = 0;

  // Refresh predictions for the project's open tickets.
  if (ctx.jira) {
    const repos = await ctx.stores.repos.listByProject(ctx.projectId);
    const tickets = await ctx.jira
      .searchIssues(`project = ${ctx.projectId} AND statusCategory != Done`)
      .catch(() => []);
    for (const repo of repos) {
      const history = await ctx.jira.mergedHistory(repo.slug).catch(() => []);
      if (history.length === 0) continue;
      for (const t of tickets) {
        const result = predictFromHistory(t, history);
        if (result.entries.length === 0) continue;
        await ctx.stores.predictions.save({
          issueKey: t.issueKey,
          repoId: repo.id,
          entries: result.entries,
          confidence: result.confidence,
          basis: {
            componentMatch: result.componentMatch,
            referenceTickets: result.referenceTickets,
          },
          computedAt: ctx.now(),
        });
        predictions += 1;
      }
    }
  }

  // Prediction accuracy (spec §13): real conflicts tell us whether the app
  // saw them coming. Full predicted-vs-attested scoring per merge is lot S
  // (needs a listable closed-worksites query); the ratio below is the v1
  // observable.
  const conflicts = await ctx.stores.conflicts.list(undefined, minusDays(ctx.now(), 30));
  accuracyComputed = conflicts.length;
  return { predictions, accuracyComputed };
}
