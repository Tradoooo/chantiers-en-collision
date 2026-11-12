/**
 * services/declare — declare-footprint and check-zone (CC-02).
 * Flow (spec §17): resolve repo → normalize paths → update the footprint
 * (declared; the fact beats the intent) → load open worksites → detect
 * collisions → assemble the verdict → log. Verdict target: < 2 s.
 */

import { entriesFromPaths, mergeEntries } from "../core/footprints";
import { formatVerdictText, verdictKindFor } from "../core/verdict";
import {
  FREEZE_SUGGESTION_THRESHOLD,
  type FootprintEntry,
  type FootprintMode,
  type Locale,
  type Verdict,
  type Worksite,
} from "../core/types";
import type { Ctx } from "./ctx";
import { detectAndVerdict } from "./detect";
import {
  ensureWorksite,
  logEvent,
  resolveRepo,
  rulesFor,
} from "./shared";

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

/** A verdict with a freeze suggestion instead of hundreds of collisions. */
async function freezeVerdict(
  ctx: Ctx,
  subject: Worksite,
  count: number,
  locale: Locale,
): Promise<Verdict> {
  const pendingNotices = await ctx.stores.notices.pendingFor([subject.id]);
  const text = formatVerdictText(
    { kind: "caution", collisions: [], notices: [] },
    locale,
    ctx.now(),
  );
  return {
    kind: verdictKindFor([], false),
    collisions: [],
    pendingNotices,
    text: `${text}\nfreeze suggested: ${count} paths in one declaration — announce a freeze instead`,
    freezeSuggestion: { paths: count },
  };
}

/** Store the declared entries (fact beats intent) and log the gaps. */
async function persistDeclaration(
  ctx: Ctx,
  worksiteId: string,
  paths: string,
  mode: FootprintMode,
  now: string,
): Promise<number> {
  const incoming = entriesFromPaths(paths, worksiteId, "declared", mode, now);
  const existing = await ctx.stores.footprints.listByWorksite(worksiteId);
  const merged = mergeEntries(existing, incoming, now);
  if (merged.toAdd.length > 0) await ctx.stores.footprints.add(merged.toAdd);
  if (merged.mismatches.length > 0) {
    await logEvent(ctx, "footprint.mismatch", worksiteId, { paths: merged.mismatches });
  }
  await logEvent(ctx, "footprint.declared", worksiteId, { count: incoming.length });
  return incoming.length;
}

export async function declareFootprint(ctx: Ctx, input: DeclareInput): Promise<Verdict> {
  const now = ctx.now();
  const locale = input.locale ?? "en";
  const { repo, zones } = await resolveRepo(ctx, input.repoSlug);
  const rules = await rulesFor(ctx);
  const ticket = ctx.jira?.getIssue
    ? ((await ctx.jira.getIssue(input.issueKey)) ?? undefined)
    : undefined;
  const w = await ensureWorksite(ctx, {
    issueKey: input.issueKey,
    repoId: repo.id,
    branch: input.branch,
    sessionRef: input.session,
    ticket,
    state: "open",
  });

  const declared = await persistDeclaration(ctx, w.id, input.paths, input.mode ?? "edit", now);

  // Spec §21: a repo-wide reformat suggests an announced freeze instead of
  // hundreds of collisions.
  if (declared > FREEZE_SUGGESTION_THRESHOLD) {
    return freezeVerdict(ctx, w, declared, locale);
  }

  const entries = await ctx.stores.footprints.listByWorksite(w.id);
  const fresh = (await ctx.stores.worksites.findById(w.id)) ?? w;
  const verdict = await detectAndVerdict(ctx, {
    subject: fresh,
    repoId: repo.id,
    zones,
    hardMode: rules.hardMode,
    locale,
    entries,
    deliverNotices: true,
    persist: true,
  });

  if (ctx.jira?.setCollisionsField) {
    const worst = verdict.collisions[0];
    const value = worst
      ? `${verdict.collisions.length} collision(s), worst D${worst.degree} (${worst.path})`
      : "none";
    await ctx.jira.setCollisionsField(input.issueKey, value).catch(() => undefined);
  }
  return verdict;
}

export interface CheckZoneInput {
  repoSlug: string;
  paths: string;
  issueKey?: string;
  locale?: Locale;
}

/** Same verdict, WITHOUT persisting anything (read-only probe). */
export async function checkZone(ctx: Ctx, input: CheckZoneInput): Promise<Verdict> {
  const now = ctx.now();
  const locale = input.locale ?? "en";
  const { repo, zones } = await resolveRepo(ctx, input.repoSlug);
  const rules = await rulesFor(ctx);

  // Virtual subject: never stored. A probe for a known ticket reuses its
  // real worksite id so pending notices can be previewed (not delivered).
  const known = input.issueKey
    ? (await ctx.stores.worksites.findByIssue(input.issueKey, repo.id))[0]
    : undefined;
  const probe: Worksite = known ?? {
    id: `probe-${now}`,
    issueKey: input.issueKey ?? "PROBE",
    repoId: repo.id,
    accountId: ctx.identity.accountId,
    kind: ctx.identity.kind,
    state: "open",
    openedAt: now,
    lastActivityAt: now,
  };
  const entries: FootprintEntry[] = entriesFromPaths(
    input.paths,
    probe.id,
    "declared",
    "edit",
    now,
  ).map((e) => ({ ...e, firstAt: now, lastAt: now }));

  return detectAndVerdict(ctx, {
    subject: probe,
    repoId: repo.id,
    zones,
    hardMode: rules.hardMode,
    locale,
    entries,
    deliverNotices: false,
    persist: false,
  });
}
