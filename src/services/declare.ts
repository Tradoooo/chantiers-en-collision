/**
 * services/declare — declare-footprint and check-zone (CC-02).
 * Owner: workstream G. Replace stubs; keep signatures EXACTLY.
 * Flow (spec §17): resolve repo → normalize paths → update footprint
 * (declared, merged via core/footprints.mergeEntries — the fact beats the
 * intent) → load open worksites → detectCollisions → buildVerdict (shared)
 * → log event. Verdict target: < 2 s.
 * A declaration over FREEZE_SUGGESTION_THRESHOLD paths sets
 * freezeSuggestion on the verdict instead of flooding collisions.
 */

import type { FootprintMode, Locale, Verdict } from "../core/types";
import type { Ctx } from "./ctx";

export interface DeclareInput {
  issueKey: string;
  repoSlug: string;
  /** One path per line. */
  paths: string;
  mode?: FootprintMode;
  etaMinutes?: number;
  session?: string;
  branch?: string;
  locale?: Locale;
}

export async function declareFootprint(_ctx: Ctx, _input: DeclareInput): Promise<Verdict> {
  throw new Error("TODO(declare): not implemented — see docs/CONTRACTS.md");
}

export interface CheckZoneInput {
  repoSlug: string;
  paths: string;
  issueKey?: string;
  locale?: Locale;
}

/** Same verdict, WITHOUT persisting anything (read-only probe). */
export async function checkZone(_ctx: Ctx, _input: CheckZoneInput): Promise<Verdict> {
  throw new Error("TODO(declare): not implemented — see docs/CONTRACTS.md");
}
