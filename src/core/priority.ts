/**
 * core/priority — who yields the way (spec §8 "Qui cède le passage").
 * Owner: workstream C. Replace each stub; keep signatures EXACTLY.
 */

import type { PriorityRules, YieldContext } from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

/**
 * Compare two worksites through the rule order and return who must yield.
 * Default order: reservation > incident > ticket priority (lower rank wins)
 * > nearest due date > most advanced (PR open > active > declared) > first
 * arrived. Tie: the agent yields to the human when rules.agentYields
 * (default); otherwise the last arrived yields.
 */
export function whoYields(_a: YieldContext, _b: YieldContext, _rules: PriorityRules): "a" | "b" {
  throw TODO("priority");
}

/** Build the advance level: 2 = PR open, 1 = open/active/paused/review, 0 = planned. */
export function advanceOf(_state: string, _prOpen?: boolean): 0 | 1 | 2 {
  throw TODO("priority");
}
