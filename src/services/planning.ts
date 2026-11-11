/**
 * services/planning — read-only planning tools (CC-11, CC-12, §12, §13).
 * Owner: workstream H. Replace stubs; keep signatures EXACTLY.
 * JQL execution goes through ctx.jira.searchIssues (injected port); in tests
 * and simulation a fake port supplies the tickets.
 */

import type {
  Collision,
  CollisionStats,
  SprintCheckData,
  TicketMeta,
  WavePlan,
} from "../core/types";
import type { Ctx } from "./ctx";

/** Colliding pairs among the tickets matched by the JQL. */
export async function listCollisions(_ctx: Ctx, _input: { jql: string }): Promise<Collision[]> {
  throw new Error("TODO(planning): not implemented — see docs/CONTRACTS.md");
}

/** Ready tickets nobody collides with — what an idle agent can start now. */
export async function listClearWork(
  _ctx: Ctx,
  _input: { jql: string; session?: string },
): Promise<TicketMeta[]> {
  throw new Error("TODO(planning): not implemented — see docs/CONTRACTS.md");
}

/** Collision-free waves for N workers (core/waves.planWaves). */
export async function planParallelWork(
  _ctx: Ctx,
  _input: { jql: string; workers: number },
): Promise<WavePlan> {
  throw new Error("TODO(planning): not implemented — see docs/CONTRACTS.md");
}

/** Sprint verification: risky pairs, hinges, suggested order (CC-19). */
export async function sprintCheck(_ctx: Ctx, _issueKeys: string[]): Promise<SprintCheckData> {
  throw new Error("TODO(planning): not implemented — see docs/CONTRACTS.md");
}

/** The four numbers of spec §13 (missedUntilMerge comes from real_conflict). */
export async function collisionStats(
  _ctx: Ctx,
  _input?: { repoSlug?: string; since?: string },
): Promise<CollisionStats> {
  throw new Error("TODO(planning): not implemented — see docs/CONTRACTS.md");
}
