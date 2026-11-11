/**
 * core/verdict — verdict kind, reason/advice wording and the formatted
 * response (spec §7, §8). Owner: workstream B. Replace stubs; keep
 * signatures EXACTLY. All strings come from src/i18n (dictFor + format).
 */

import type {
  Degree,
  Locale,
  NeighborInfo,
  VerdictCollisionInfo,
  VerdictKind,
  ZoneNature,
} from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

/**
 * Overall verdict from the worst collision:
 *  - none, or D0 only → free (neighbour still mentioned in the text)
 *  - D1, D2 → caution
 *  - D3 → wait (advice says "or coordinate")
 *  - D4 → wait; stop when hardMode
 *  - D5 → caution with coordinate advice (lot C)
 */
export function verdictKindFor(
  _collisions: VerdictCollisionInfo[],
  _hardMode: boolean,
): VerdictKind {
  throw TODO("verdict");
}

/**
 * Human label for a neighbour, e.g.
 *  - "agent of lea@example.com (session 3f2a)"   (agent)
 *  - "lea@example.com"                            (human)
 * Uses i18n tag.agentOf / tag.session.
 */
export function neighborLabel(_n: NeighborInfo, _locale: Locale): string {
  throw TODO("verdict");
}

export interface ReasonParams {
  degree: Degree;
  zoneNature: ZoneNature;
  zoneName?: string;
  /** ISO expiry of a reservation / freeze, when relevant. */
  until?: string;
  reservedByIssueKey?: string;
  locale: Locale;
}

/** The "reason" line: why this collision exists (i18n reason.* messages). */
export function reasonForCollision(_p: ReasonParams): string {
  throw TODO("verdict");
}

export interface AdviceParams {
  degree: Degree;
  zoneNature: ZoneNature;
  zoneName?: string;
  neighborIssueKey: string;
  /** Neighbour PR is open → advise waiting for the merge, it is close. */
  neighborPrOpen?: boolean;
  hardMode: boolean;
  locale: Locale;
}

/** The "what to do" line (i18n advice.* messages). */
export function adviceForCollision(_p: AdviceParams): string {
  throw TODO("verdict");
}

/**
 * Format the verdict text block exactly like spec §8 "Forme de la réponse":
 *
 *   verdict : wait
 *   collision : D4 · exclusive zone "migrations"
 *   neighbor : PROJ-88 · agent of Léa (session 3f2a) · PR open · active 4 min ago
 *   reason : one worksite at a time in exclusive zone "migrations"
 *   neighbor's notice : "renaming invoices.total to total_cents"
 *   what to do : keep working outside migrations, then redeclare after PROJ-88 merges
 *   estimated resume : 25 min
 *
 * One block per collision (worst first, max 3), then pending notices.
 * No hard-coded strings — everything through src/i18n.
 */
export function formatVerdictText(
  _v: {
    kind: VerdictKind;
    collisions: VerdictCollisionInfo[];
    notices: { fromIssueKey: string; text: string }[];
  },
  _locale: Locale,
  _now: string,
): string {
  throw TODO("verdict");
}
