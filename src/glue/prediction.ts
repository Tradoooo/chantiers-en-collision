/**
 * glue/prediction — the predicted footprint of a ticket (spec §5, §12).
 * Owner: workstream I (glue). Shared by the `predict-footprint` tool, the
 * issue-created trigger and the daily job, so the logic exists ONCE.
 *
 * Prediction is a probability: it never blocks, it is capped at D1 by the
 * degrees layer, and its confidence is always announced. Two bases, both from
 * our own data: the ticket's components and the merged tickets of the same
 * project/repository (JiraPort.mergedHistory — rebuilt from attested
 * footprints, because no Jira API lists the files of a merged ticket, §19).
 */

import type { FootprintPrediction, TicketMeta } from "../core/types";
import { predictFromHistory } from "../core/predict";
import type { Ctx } from "../services/ctx";

/** Prediction already stored by the daily job, or one computed on the fly. */
export interface PredictionLookup {
  prediction?: FootprintPrediction;
  cached: boolean;
}

/**
 * The repository the prediction is computed against: the project's first
 * registered repository. Documented best effort — a project with several
 * repositories predicts on the main one (the panel shows every repo anyway).
 */
export async function predictionRepo(ctx: Ctx) {
  const repos = await ctx.stores.repos.listByProject(ctx.projectId);
  return repos[0];
}

/** Compute (and store) the prediction of a ticket; undefined when impossible. */
export async function computePrediction(
  ctx: Ctx,
  issueKey: string,
): Promise<FootprintPrediction | undefined> {
  const repo = await predictionRepo(ctx);
  if (repo === undefined || ctx.jira === undefined) return undefined;
  const ticket: TicketMeta = (await ctx.jira.getIssue(issueKey)) ?? { issueKey, components: [] };
  const history = await ctx.jira.mergedHistory(repo.slug);
  const result = predictFromHistory(ticket, history);
  if (result.entries.length === 0) return undefined;
  const prediction: FootprintPrediction = {
    issueKey,
    repoId: repo.id,
    entries: result.entries,
    confidence: result.confidence,
    basis: {
      componentMatch: result.componentMatch,
      referenceTickets: result.referenceTickets,
    },
    computedAt: ctx.now(),
  };
  await ctx.stores.predictions.save(prediction);
  return prediction;
}

/** Stored prediction first (the daily job keeps it fresh), computed otherwise. */
export async function predictionFor(ctx: Ctx, issueKey: string): Promise<PredictionLookup> {
  const stored = await ctx.stores.predictions.findByIssue(issueKey);
  if (stored.length > 0) return { prediction: stored[0], cached: true };
  return { prediction: await computePrediction(ctx, issueKey), cached: false };
}

/**
 * Store the predicted paths as footprint entries of a worksite (source
 * "predicted"), so a ticket that has not been declared yet is still visible on
 * the map — capped at D1 and tagged `probable` by the core, never blocking.
 */
export async function storePredictedFootprint(
  ctx: Ctx,
  worksiteId: string,
  prediction: FootprintPrediction,
): Promise<number> {
  const at = ctx.now();
  const entries = prediction.entries.map((entry) => ({
    worksiteId,
    path: entry.path,
    kind: entry.kind,
    source: "predicted" as const,
    mode: "edit" as const,
    at,
  }));
  if (entries.length === 0) return 0;
  await ctx.stores.footprints.add(entries);
  return entries.length;
}
