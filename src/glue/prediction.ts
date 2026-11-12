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

import type { FootprintPrediction, MergedTicketHistory, TicketMeta } from "../core/types";
import { predictFromHistory } from "../core/predict";
import type { PredictionResult } from "../core/predict";
import { predictFootprintWithLlm } from "../services/predict-llm";
import type { LlmPrediction, LlmPredictorConfig } from "../services/predict-llm";
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

/**
 * LLM supplement (spec §14 CC-24): when the heuristic is weak — no entry or
 * confidence < LLM_MIN_HEURISTIC — and the inferhub gateway is configured via
 * Forge variables (INFERHUB_API_URL / INFERHUB_API_KEY [secret], optional
 * INFERHUB_MODEL), the ticket text is predicted by the model too. It stays a
 * supplement: its confidence is discounted (LLM_DISCOUNT) and it never
 * blocks — predictFootprintWithLlm is fail-soft (spec §26).
 */
const LLM_MIN_HEURISTIC = 0.4;
const LLM_DISCOUNT = 0.9;
const DEFAULT_LLM_MODEL = "combo/cheap";

/** Gateway config from the environment; undefined when not configured. */
function llmConfigFromEnv(): LlmPredictorConfig | undefined {
  const baseUrl = process.env.INFERHUB_API_URL;
  const apiKey = process.env.INFERHUB_API_KEY;
  if (baseUrl === undefined || baseUrl === "" || apiKey === undefined || apiKey === "") {
    return undefined;
  }
  return { baseUrl, apiKey, model: process.env.INFERHUB_MODEL ?? DEFAULT_LLM_MODEL };
}

/** The heuristic alone is not enough to announce a useful footprint. */
function heuristicIsWeak(result: PredictionResult): boolean {
  return result.entries.length === 0 || result.confidence < LLM_MIN_HEURISTIC;
}

/**
 * Merge: LLM entries absent from the heuristic are appended (tagged in basis
 * via referenceTickets prefixed "llm:"); final confidence =
 * max(heuristic, llm × LLM_DISCOUNT) — the model is an appoint, never more.
 * Exported for tests (pure).
 */
export function mergeLlmPrediction(heuristic: PredictionResult, llm: LlmPrediction): PredictionResult {
  const known = new Set(heuristic.entries.map((entry) => entry.path));
  const entries = [...heuristic.entries];
  for (const entry of llm.entries) {
    if (known.has(entry.path)) continue;
    known.add(entry.path);
    entries.push(entry);
  }
  entries.sort((a, b) => b.confidence - a.confidence || a.path.localeCompare(b.path));
  // The LlmPrediction contract carries no overall confidence: derive it from
  // the best entry (same spirit as core/predict's top-entries average).
  const llmConfidence = llm.entries.reduce((max, entry) => Math.max(max, entry.confidence), 0);
  const confidence =
    Math.round(Math.min(1, Math.max(heuristic.confidence, llmConfidence * LLM_DISCOUNT)) * 100) /
    100;
  return {
    entries,
    confidence,
    referenceTickets: [
      ...heuristic.referenceTickets,
      ...llm.referenceTickets.map((key) => `llm:${key}`),
    ],
    componentMatch: heuristic.componentMatch,
  };
}

/**
 * Compute (and store) the prediction of a ticket; undefined when impossible.
 * Heuristic first (core/predict); when it is weak and the inferhub gateway is
 * configured, the LLM supplements it (CC-24). The result is cached in
 * PredictionStore either way — the daily job keeps it fresh.
 */
export async function computePrediction(
  ctx: Ctx,
  issueKey: string,
): Promise<FootprintPrediction | undefined> {
  const repo = await predictionRepo(ctx);
  if (repo === undefined || ctx.jira?.getIssue === undefined || ctx.jira.mergedHistory === undefined) {
    return undefined;
  }
  const ticket: TicketMeta = (await ctx.jira.getIssue(issueKey)) ?? { issueKey, components: [] };
  const history: MergedTicketHistory[] = await ctx.jira.mergedHistory(repo.slug);
  const heuristic = predictFromHistory(ticket, history);
  const llmCfg = heuristicIsWeak(heuristic) ? llmConfigFromEnv() : undefined;
  const llm = llmCfg === undefined
    ? undefined
    : await predictFootprintWithLlm(ticket, history, llmCfg);
  const result = llm === undefined ? heuristic : mergeLlmPrediction(heuristic, llm);
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
