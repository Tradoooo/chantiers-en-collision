/**
 * core/predict — footprint prediction from components and similar merged
 * tickets (spec §5 "Prédite", §13). Owner: workstream D.
 *
 * Prediction is a probability, never blocking: it is capped at D1 by the
 * degrees layer, its confidence is announced, and it is measured against the
 * attested footprint at merge time (spec §13). Two bases, per spec §5:
 *  1. the ticket's component — the paths its merged neighbours touched;
 *  2. tickets with a similar summary — same idea, lower weight.
 * A directory that shows up in most tickets of a component is preferred to
 * its files: predicting `src/billing` is both truer and quieter than listing
 * fifteen files.
 */

import type { MergedTicketHistory, PathKind, PredictedPath, TicketMeta } from "./types";
import { classifyPath } from "./paths";

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

/** English stopwords that carry no signal in a Jira summary. */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "was",
  "will",
]);

const DEFAULT_MAX_ENTRIES = 30;
const DEFAULT_MIN_CONFIDENCE = 0.15;
const COMPONENT_WEIGHT = 1;
const SUMMARY_WEIGHT = 0.5;
const JACCARD_MIN = 0.3;
const ROLLUP_SHARE = 0.6;
const REFERENCE_TICKETS = 5;
const MIN_TOKEN_LENGTH = 3;
const CONFIDENCE_ENTRIES = 5;

/** Tokenize a summary for similarity (lowercase, drop punctuation/stopwords). */
export function summaryTokens(summary: string): string[] {
  const cleaned = summary.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const tokens: string[] = [];
  for (const token of cleaned.split(" ")) {
    if (token.length < MIN_TOKEN_LENGTH || STOPWORDS.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Tickets sharing at least one component with the issue. */
function componentPool(issue: TicketMeta, history: MergedTicketHistory[]): MergedTicketHistory[] {
  const wanted = new Set(issue.components);
  if (wanted.size === 0) return [];
  return history.filter((ticket) => ticket.components.some((c) => wanted.has(c)));
}

/** Immediate parent directory of a path, when there is one. */
function parentOf(path: string): string | undefined {
  const index = path.lastIndexOf("/");
  return index <= 0 ? undefined : path.slice(0, index);
}

/** The directory a path would roll up into (dirs roll up to themselves). */
function rollupKey(path: string, kind: PathKind): string | undefined {
  if (kind === "dir") return path;
  if (kind === "file") return parentOf(path);
  return undefined;
}

/** Dirs covering at least ROLLUP_SHARE of the pool's tickets. */
function frequentDirs(pool: MergedTicketHistory[]): Set<string> {
  if (pool.length === 0) return new Set();
  const hits = new Map<string, number>();
  for (const ticket of pool) {
    const keys = new Set<string>();
    for (const path of ticket.paths) {
      const key = rollupKey(path, classifyPath(path));
      if (key !== undefined) keys.add(key);
    }
    for (const key of keys) hits.set(key, (hits.get(key) ?? 0) + 1);
  }
  const rolled = new Set<string>();
  for (const [dir, count] of hits) {
    if (count / pool.length >= ROLLUP_SHARE) rolled.add(dir);
  }
  return rolled;
}

/** Paths a ticket contributes once frequent dirs are rolled up. */
function effectivePaths(ticket: MergedTicketHistory, rolled: Set<string>): Map<string, PathKind> {
  const out = new Map<string, PathKind>();
  for (const path of ticket.paths) {
    const kind = classifyPath(path);
    const key = rollupKey(path, kind);
    if (key !== undefined && rolled.has(key)) {
      out.set(key, "dir");
    } else {
      out.set(path, kind);
    }
  }
  return out;
}

interface Contribution {
  ticket: MergedTicketHistory;
  weight: number;
  paths: Map<string, PathKind>;
}

/** Which merged tickets take part, and with which weight. */
function contributions(
  issue: TicketMeta,
  history: MergedTicketHistory[],
  pool: MergedTicketHistory[],
): Contribution[] {
  const rolled = frequentDirs(pool);
  const componentKeys = new Set(pool.map((ticket) => ticket.issueKey));
  const issueTokens = new Set(summaryTokens(issue.summary ?? ""));
  const seen = new Set<string>();
  const out: Contribution[] = [];
  for (const ticket of history) {
    if (seen.has(ticket.issueKey)) continue;
    const byComponent = componentKeys.has(ticket.issueKey);
    const similar = jaccard(issueTokens, new Set(summaryTokens(ticket.summary ?? ""))) >= JACCARD_MIN;
    if (!byComponent && !similar) continue;
    seen.add(ticket.issueKey);
    out.push({
      ticket,
      weight: byComponent ? COMPONENT_WEIGHT : SUMMARY_WEIGHT,
      paths: effectivePaths(ticket, rolled),
    });
  }
  return out;
}

/** score(path) = sum of contributing weights / number of contributing tickets. */
function scorePaths(list: Contribution[]): Map<string, PredictedPath> {
  const scores = new Map<string, PredictedPath>();
  if (list.length === 0) return scores;
  for (const contribution of list) {
    for (const [path, kind] of contribution.paths) {
      const current = scores.get(path);
      const confidence = (current?.confidence ?? 0) + contribution.weight;
      scores.set(path, { path, kind, confidence });
    }
  }
  for (const predicted of scores.values()) predicted.confidence /= list.length;
  return scores;
}

function sortByScore(entries: PredictedPath[]): PredictedPath[] {
  return [...entries].sort(
    (a, b) => b.confidence - a.confidence || a.path.localeCompare(b.path),
  );
}

/** Announced confidence: average of the top entries, halved without a match. */
function overallConfidence(entries: PredictedPath[], componentMatch: boolean): number {
  if (entries.length === 0) return 0;
  const top = entries.slice(0, CONFIDENCE_ENTRIES);
  const average = top.reduce((sum, entry) => sum + entry.confidence, 0) / top.length;
  const halved = componentMatch ? average : average * 0.5;
  return Math.round(Math.min(1, Math.max(0, halved)) * 100) / 100;
}

/** The merged tickets that brought the most paths. */
function referenceTickets(list: Contribution[]): string[] {
  return [...list]
    .sort((a, b) => b.paths.size - a.paths.size || b.weight - a.weight)
    .slice(0, REFERENCE_TICKETS)
    .map((contribution) => contribution.ticket.issueKey);
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
  issue: TicketMeta,
  history: MergedTicketHistory[],
  opts?: PredictOptions,
): PredictionResult {
  const pool = componentPool(issue, history);
  const componentMatch = pool.length > 0;
  const list = contributions(issue, history, pool);
  if (list.length === 0) {
    return { entries: [], confidence: 0, referenceTickets: [], componentMatch: false };
  }

  const minConfidence = opts?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = sortByScore([...scorePaths(list).values()])
    .filter((entry) => entry.confidence >= minConfidence)
    .slice(0, maxEntries)
    .map((entry) => ({ ...entry, confidence: Math.round(entry.confidence * 100) / 100 }));

  return {
    entries,
    confidence: overallConfidence(entries, componentMatch),
    referenceTickets: referenceTickets(list),
    componentMatch,
  };
}

export type { PathKind };
