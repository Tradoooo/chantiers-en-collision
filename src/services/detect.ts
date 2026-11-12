/**
 * services/detect — THE detection path (spec §17 steps 3-6).
 *
 * `declare` (MCP declare-footprint / check-zone) and `ingest` (hook open /
 * touch, CI footprint) used to run the very same sequence twice: load the
 * open worksites, load the active reservations, detect the collisions,
 * assemble the verdict. ONE implementation here — the two entry points can
 * no longer drift apart and can no longer return different verdicts.
 *
 * No @forge/* import here: pure orchestration over Stores + core/*.
 */

import { detectCollisions } from "../core/collisions";
import type { FootprintEntry, Locale, Verdict, Worksite, Zone } from "../core/types";
import type { Ctx } from "./ctx";
import { buildVerdict, loadOpenWorksites, rulesFor } from "./shared";

export interface DetectInput {
  /** The worksite the verdict is about. */
  subject: Worksite;
  repoId: string;
  /** Zones of the repo (read from the store when omitted). */
  zones?: Zone[];
  /** Hard mode (read from the project rules when omitted). */
  hardMode?: boolean;
  /** Locale of the verdict text (English by default). */
  locale?: Locale;
  /** Deliver the pending notices (MCP/hook answers deliver once). */
  deliverNotices: boolean;
  /** False for a read-only probe: the collisions are NOT persisted. */
  persist?: boolean;
  /**
   * Footprint entries of the subject. Loaded from the store when omitted —
   * except for a virtual probe (check-zone), which carries its own entries.
   */
  entries?: FootprintEntry[];
}

/**
 * Detect the collisions of the subject against the other open worksites of
 * the repo and assemble the verdict (the single place a Verdict is built).
 */
export async function detectAndVerdict(ctx: Ctx, input: DetectInput): Promise<Verdict> {
  const now = ctx.now();
  const zones = input.zones ?? (await ctx.stores.zones.listByRepo(input.repoId));
  const hardMode = input.hardMode ?? (await rulesFor(ctx)).hardMode;
  const entries =
    input.entries ?? (await ctx.stores.footprints.listByWorksite(input.subject.id));
  const others = (await loadOpenWorksites(ctx, input.repoId)).filter(
    (o) => o.worksite.id !== input.subject.id,
  );
  const reservations = await ctx.stores.reservations.listActive(input.repoId, now);
  const drafts = detectCollisions({ worksite: input.subject, entries }, others, {
    zones,
    reservations,
    now,
    hardMode,
  });
  return buildVerdict(ctx, {
    subject: input.subject,
    drafts,
    othersById: new Map(others.map((o) => [o.worksite.id, o])),
    zones,
    reservations,
    hardMode,
    locale: input.locale,
    deliverNotices: input.deliverNotices,
    persist: input.persist,
  });
}
