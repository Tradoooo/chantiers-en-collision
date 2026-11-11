/**
 * services/declare — declare-footprint and check-zone (CC-02).
 * Flow (spec §17): resolve repo → normalize paths → update the footprint
 * (declared; the fact beats the intent) → load open worksites → detect
 * collisions → assemble the verdict → log. Verdict target: < 2 s.
 */

import { detectCollisions } from "../core/collisions";
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
import {
  buildVerdict,
  ensureWorksite,
  loadOpenWorksites,
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

export async function declareFootprint(ctx: Ctx, input: DeclareInput): Promise<Verdict> {
  const now = ctx.now();
  const locale = input.locale ?? "en";
  const { repo, zones } = await resolveRepo(ctx, input.repoSlug);
  const rules = await rulesFor(ctx);
  const ticket = ctx.jira
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

  const incoming = entriesFromPaths(input.paths, w.id, "declared", input.mode ?? "edit", now);
  const existing = await ctx.stores.footprints.listByWorksite(w.id);
  const merged = mergeEntries(existing, incoming, now);
  if (merged.toAdd.length > 0) await ctx.stores.footprints.add(merged.toAdd);
  if (merged.mismatches.length > 0) {
    await logEvent(ctx, "footprint.mismatch", w.id, { paths: merged.mismatches });
  }
  await logEvent(ctx, "footprint.declared", w.id, { count: incoming.length });

  // Spec §21: a repo-wide reformat suggests an announced freeze instead of
  // hundreds of collisions.
  if (incoming.length > FREEZE_SUGGESTION_THRESHOLD) {
    return freezeVerdict(ctx, w, incoming.length, locale);
  }

  const entries = await ctx.stores.footprints.listByWorksite(w.id);
  const fresh = (await ctx.stores.worksites.findById(w.id)) ?? w;
  const subject = { worksite: fresh, entries };
  const others = (await loadOpenWorksites(ctx, repo.id)).filter(
    (o) => o.worksite.id !== fresh.id,
  );
  const reservations = await ctx.stores.reservations.listActive(repo.id, now);
  const drafts = detectCollisions(subject, others, {
    zones,
    reservations,
    now,
    hardMode: rules.hardMode,
  });

  const verdict = await buildVerdict(ctx, {
    subject: fresh,
    drafts,
    othersById: new Map(others.map((o) => [o.worksite.id, o])),
    zones,
    reservations,
    hardMode: rules.hardMode,
    locale,
    deliverNotices: true,
  });

  if (ctx.jira) {
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

  const others = (await loadOpenWorksites(ctx, repo.id)).filter(
    (o) => o.worksite.id !== probe.id,
  );
  const reservations = await ctx.stores.reservations.listActive(repo.id, now);
  const drafts = detectCollisions({ worksite: probe, entries }, others, {
    zones,
    reservations,
    now,
    hardMode: rules.hardMode,
  });

  return buildVerdict(ctx, {
    subject: probe,
    drafts,
    othersById: new Map(others.map((o) => [o.worksite.id, o])),
    zones,
    reservations,
    hardMode: rules.hardMode,
    locale,
    deliverNotices: false,
    persist: false,
  });
}
