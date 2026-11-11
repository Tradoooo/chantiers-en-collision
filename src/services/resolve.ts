/**
 * services/resolve — the six outcomes of a collision (CC-20, spec §8).
 * Owner: workstream G. Replace stubs; keep signatures EXACTLY.
 *
 * wait       → the yielding worksite enters the zone queue; on release its
 *              pilot is notified and the next call answers "free"
 * sequence   → whoYields decides; returns linkToCreate ("is blocked by")
 * coordinate → a notice goes to the neighbour; both pilots are mentioned
 * split      → splitTicketDraft prepared (summary/description/paths)
 * merge      → same file, same goal: one worksite does both
 * override   → reason REQUIRED; the app later checks whether a real
 *              conflict followed (real_conflict.wasDetected)
 */

import type { ResolutionChoice, ResolutionOutcome } from "../core/types";
import type { Ctx } from "./ctx";

export interface ResolveInput {
  collisionId: string;
  choice: ResolutionChoice;
  reason?: string;
}

export async function resolveCollision(
  _ctx: Ctx,
  _input: ResolveInput,
): Promise<ResolutionOutcome> {
  throw new Error("TODO(resolve): not implemented — see docs/CONTRACTS.md");
}
