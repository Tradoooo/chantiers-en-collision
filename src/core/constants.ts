/**
 * core/constants — the product's narrative constants, in ONE place.
 *
 * The pitch and the UI talk in fixed counts: four verdicts, six degrees
 * (D0–D5). The engine, the browser demo and the doc generators read them
 * HERE, never re-typed — change a list once, everything follows.
 *
 * Footprint sources and modes already have their single source in
 * `core/footprints` (`SOURCE_RANK`, `MODE_RANK`); the verdict *wording* has its
 * single source in `src/i18n` (one key per message, per language).
 */

import type { Degree, VerdictKind } from "./types";

/** The four verdicts, in the order the product shows them. */
export const VERDICT_KINDS = [
  "free",
  "caution",
  "wait",
  "stop",
] as const satisfies readonly VerdictKind[];

/** The six degrees the engine can emit, D0..D5. */
export const DEGREES = [0, 1, 2, 3, 4, 5] as const satisfies readonly Degree[];

/** Sanity anchors, so a future edit cannot silently drop one without a test. */
export const VERDICT_COUNT: number = VERDICT_KINDS.length;
export const DEGREE_COUNT: number = DEGREES.length;