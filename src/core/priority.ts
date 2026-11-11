/**
 * core/priority — who yields the way (spec §8 "Qui cède le passage").
 * Owner: workstream C.
 */

import type { PriorityCriterion, PriorityRules, YieldContext } from "./types";

type Side = "a" | "b";

const WORST = Number.POSITIVE_INFINITY;

/** Epoch millis of an ISO date; missing or unparseable = worst possible. */
function timeOf(iso: string | undefined): number {
  if (!iso) return WORST;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? WORST : ms;
}

/**
 * One criterion, one comparison. Returns the side that must yield, or
 * `undefined` when the criterion cannot tell them apart.
 */
function compareCriterion(
  criterion: PriorityCriterion,
  a: YieldContext,
  b: YieldContext,
): Side | undefined {
  switch (criterion) {
    case "reservation":
      if (a.hasActiveReservation === b.hasActiveReservation) return undefined;
      return a.hasActiveReservation ? "b" : "a";
    case "incident":
      if (a.incident === b.incident) return undefined;
      return a.incident ? "b" : "a";
    case "priority": {
      const rankA = a.priorityRank ?? WORST;
      const rankB = b.priorityRank ?? WORST;
      if (rankA === rankB) return undefined;
      return rankA < rankB ? "b" : "a";
    }
    case "due": {
      const dueA = timeOf(a.dueAt);
      const dueB = timeOf(b.dueAt);
      if (dueA === dueB) return undefined;
      return dueA < dueB ? "b" : "a";
    }
    case "advance":
      if (a.advance === b.advance) return undefined;
      return a.advance > b.advance ? "b" : "a";
    case "first": {
      const arrA = timeOf(a.arrivedAt);
      const arrB = timeOf(b.arrivedAt);
      if (arrA === arrB) return undefined;
      return arrA < arrB ? "b" : "a";
    }
    default:
      return undefined;
  }
}

/**
 * Nothing differentiates the two sides: the agent steps back when allowed
 * (waiting costs it less), otherwise whoever arrived last gives way.
 */
function tieBreak(a: YieldContext, b: YieldContext, rules: PriorityRules): Side {
  if (rules.agentYields && a.kind !== b.kind) return a.kind === "agent" ? "a" : "b";
  const arrA = timeOf(a.arrivedAt);
  const arrB = timeOf(b.arrivedAt);
  if (arrA === arrB) return "b";
  return arrA > arrB ? "a" : "b";
}

/**
 * Compare two worksites through the rule order and return who must yield.
 * Default order: reservation > incident > ticket priority (lower rank wins)
 * > nearest due date > most advanced (PR open > active > declared) > first
 * arrived. Tie: the agent yields to the human when rules.agentYields
 * (default); otherwise the last arrived yields.
 */
export function whoYields(a: YieldContext, b: YieldContext, rules: PriorityRules): "a" | "b" {
  for (const criterion of rules.order) {
    const yielded = compareCriterion(criterion, a, b);
    if (yielded) return yielded;
  }
  return tieBreak(a, b, rules);
}

/**
 * Build the advance level: 2 = PR open or under review (the work is out),
 * 1 = open/active/paused, 0 = planned only.
 */
export function advanceOf(state: string, prOpen?: boolean): 0 | 1 | 2 {
  if (prOpen) return 2;
  if (state === "review") return 2;
  if (state === "planned") return 0;
  return 1;
}
