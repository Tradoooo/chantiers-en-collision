/**
 * services/worksites — open/pause/close/panel/who-touches (CC-01, CC-09).
 * Owner: workstream G. Replace stubs; keep signatures EXACTLY.
 * closeWorksite releases neighbours waiting on the freed zone: after the
 * state flip, re-run detection for colliding open worksites so their next
 * call answers "free" (spec §8 "Attendre").
 */

import type {
  ActorKind,
  NeighborInfo,
  TicketMeta,
  Worksite,
  WorksiteOutcome,
  WorksitePanel,
} from "../core/types";
import type { Ctx } from "./ctx";

export interface OpenInput {
  issueKey: string;
  repoSlug: string;
  branch?: string;
  sessionRef?: string;
  kind?: ActorKind;
  ticket?: TicketMeta;
}

export async function openWorksite(_ctx: Ctx, _input: OpenInput): Promise<Worksite> {
  throw new Error("TODO(worksites): not implemented — see docs/CONTRACTS.md");
}

/** Session end / branch pushed without PR → paused. */
export async function pauseWorksite(
  _ctx: Ctx,
  _input: { sessionRef?: string; issueKey?: string; repoSlug?: string },
): Promise<Worksite | undefined> {
  throw new Error("TODO(worksites): not implemented — see docs/CONTRACTS.md");
}

export interface CloseInput {
  issueKey: string;
  repoSlug?: string;
  session?: string;
  outcome?: WorksiteOutcome;
}

export async function closeWorksite(
  _ctx: Ctx,
  _input: CloseInput,
): Promise<{ closed: Worksite[]; released: NeighborInfo[] }> {
  throw new Error("TODO(worksites): not implemented — see docs/CONTRACTS.md");
}

/** Panel data for a ticket: everything of spec §16.1. */
export async function getWorksitePanel(_ctx: Ctx, _issueKey: string): Promise<WorksitePanel> {
  throw new Error("TODO(worksites): not implemented — see docs/CONTRACTS.md");
}

/** Worksites present on a path, with state and last activity. */
export async function whoTouches(
  _ctx: Ctx,
  _input: { repoSlug: string; path: string },
): Promise<NeighborInfo[]> {
  throw new Error("TODO(worksites): not implemented — see docs/CONTRACTS.md");
}

/** Record activity: lastActivityAt = now; dormant → active; paused → active. */
export async function markActivity(_ctx: Ctx, _worksiteId: string): Promise<void> {
  throw new Error("TODO(worksites): not implemented — see docs/CONTRACTS.md");
}
