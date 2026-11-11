/**
 * core/predict — footprint prediction from components and similar merged
 * tickets (spec §5 "Prédite", §13). Owner: workstream D. Replace stubs.
 */

import type { MergedTicketHistory, PathKind, PredictedPath, TicketMeta } from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

export interface PredictionResult {
  entries: PredictedPath[];
  /** 0..1 — drives the announced confidence; never blocking. */
  confidence: number;
  referenceTickets: string[];
  componentMatch: boolean;
}

export interface PredictOptions {
  minConfidence?: number;
  /** Max entries returned (default 30). */
  maxEntries?: number;
}

/**
 * Predict from history:
 *  1. tickets sharing a component → frequency of their paths (dir-level
 *     rollup when a dir appears often);
 *  2. tickets with a similar summary (token Jaccard ≥ 0.3) → their paths,
 *     lower weight;
 *  3. confidence = share of history tickets agreeing on the top paths,
 *     halved when no component matched;
 *  4. referenceTickets = the merged tickets used (max 5).
 * Kind of predicted paths: use classifyPath.
 */
export function predictFromHistory(
  _issue: TicketMeta,
  _history: MergedTicketHistory[],
  _opts?: PredictOptions,
): PredictionResult {
  throw TODO("predict");
}

/** Tokenize a summary for similarity (lowercase, drop punctuation/stopwords). */
export function summaryTokens(_summary: string): string[] {
  throw TODO("predict");
}

export type { PathKind };
