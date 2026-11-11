/**
 * services/ingest — hook endpoint logic and CI entry point
 * (CC-05, CC-13, spec §9.3, §10, §17).
 * Owner: workstream H. Replace stubs; keep signatures EXACTLY.
 *
 * hookOpen   : SessionStart — read the branch, find the ticket key in it
 *              (PROJ-123 pattern), open the worksite; response injects the
 *              neighbour list into the agent context (additionalContext).
 * hookTouch  : PreToolUse — the path enters the OBSERVED footprint; if it
 *              widens the declaration the gap is noted and detection is
 *              replayed; caution → additionalContext; hard mode + reserved
 *              or frozen zone → deny with reason and release time.
 * hookClose  : SessionEnd — worksite paused (best effort within 1.5 s;
 *              dormancy is the safety net).
 * ciFootprint: branch file list → ATTESTED footprint; works without any
 *              cooperation (humans included); branch merges the base branch
 *              → files counted from the divergence point (caller computes).
 * reportConflict: real merge/rebase conflict; wasDetected = the app had an
 *              open collision on the same pair/paths.
 */

import type {
  CiFootprintInput,
  HookOpenEvent,
  HookResponse,
  HookTouchEvent,
  RealConflict,
  Worksite,
} from "../core/types";
import type { Ctx } from "./ctx";

export async function hookOpen(
  _ctx: Ctx,
  _ev: HookOpenEvent,
): Promise<{ worksite?: Worksite; response: HookResponse }> {
  throw new Error("TODO(ingest): not implemented — see docs/CONTRACTS.md");
}

export async function hookTouch(_ctx: Ctx, _ev: HookTouchEvent): Promise<HookResponse> {
  throw new Error("TODO(ingest): not implemented — see docs/CONTRACTS.md");
}

export async function hookClose(
  _ctx: Ctx,
  _ev: { sessionRef: string; reason?: string },
): Promise<void> {
  throw new Error("TODO(ingest): not implemented — see docs/CONTRACTS.md");
}

export async function ciFootprint(
  _ctx: Ctx,
  _input: CiFootprintInput,
): Promise<{ worksite?: Worksite; entries: number }> {
  throw new Error("TODO(ingest): not implemented — see docs/CONTRACTS.md");
}

export async function reportConflict(
  _ctx: Ctx,
  _input: { issueKey: string; repoSlug: string; paths: string; withIssueKey?: string },
): Promise<RealConflict> {
  throw new Error("TODO(ingest): not implemented — see docs/CONTRACTS.md");
}
