/**
 * services/shared — plumbing shared by every service.
 * Owner: orchestrator. FROZEN: do not modify; report gaps instead.
 *
 * Pure orchestration over Stores + core/*; no @forge/* import here.
 */

import type {
  ActorKind,
  ActorSession,
  CollisionDraft,
  Locale,
  NeighborInfo,
  RepoRecord,
  Reservation,
  TicketMeta,
  Verdict,
  VerdictCollisionInfo,
  Worksite,
  WorksiteState,
  Zone,
} from "../core/types";
import type { WorksiteWithEntries } from "../core/collisions";
import {
  adviceForCollision,
  formatVerdictText,
  neighborLabel,
  reasonForCollision,
  verdictKindFor,
} from "../core/verdict";
import { minutesBetween } from "../testing/clock";
import { normalizePath } from "../core/paths";
import type { Ctx } from "./ctx";

/* ------------------------------------------------------------------ */
/* Repos and zones                                                     */
/* ------------------------------------------------------------------ */

/** Trim a slug; drop leading/trailing slashes; keep case (provider-side). */
export function normalizeSlug(slug: string): string {
  return slug.trim().replace(/^\/+|\/+$/g, "");
}

/**
 * Split a paths block (MCP inputs: one path per line) into normalized
 * paths; blank lines and "#" comments are ignored, duplicates removed.
 */
export function splitPathsBlock(paths: string): string[] {
  const out: string[] = [];
  for (const raw of paths.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const p = normalizePath(line);
    if (p !== "" && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Find-or-create the repo and return it with its zones (defaults seeded). */
export async function resolveRepo(
  ctx: Ctx,
  slug: string,
): Promise<{ repo: RepoRecord; zones: Zone[] }> {
  const repo = await ctx.stores.repos.ensure(ctx.projectId, normalizeSlug(slug));
  await ctx.stores.zones.seedDefaults(repo.id); // idempotent
  const zones = await ctx.stores.zones.listByRepo(repo.id);
  return { repo, zones };
}

/* ------------------------------------------------------------------ */
/* Worksites                                                           */
/* ------------------------------------------------------------------ */

export interface EnsureWorksiteInput {
  issueKey: string;
  repoId: string;
  branch?: string;
  /** Agent sessions pass a sessionRef; human worksites pass none. */
  sessionRef?: string;
  kind?: ActorKind;
  client?: string;
  ticket?: TicketMeta;
  state?: WorksiteState;
}

/**
 * Find the open worksite of (ticket, repo, session) or create it.
 * Session-bearing callers get their own worksite; humans (no session) never
 * reuse an agent's worksite and vice versa. Reactivating a dormant worksite
 * marks it active again.
 */
export async function ensureWorksite(ctx: Ctx, input: EnsureWorksiteInput): Promise<Worksite> {
  const now = ctx.now();
  const kind = input.kind ?? ctx.identity.kind;
  let sessionId: string | undefined;
  if (input.sessionRef) {
    const session: ActorSession = await ctx.stores.sessions.touch({
      accountId: ctx.identity.accountId,
      kind,
      client: input.client ?? ctx.identity.client,
      sessionRef: input.sessionRef,
      agentRef: ctx.identity.agentRef,
      parentSessionId: undefined,
      at: now,
    });
    sessionId = session.id;
  }
  const candidates = await ctx.stores.worksites.findByIssue(input.issueKey, input.repoId);
  const match = candidates.find((w) => (sessionId ? w.sessionId === sessionId : !w.sessionId));
  if (match) {
    const patch: Partial<Worksite> = { lastActivityAt: now };
    if (input.branch) patch.branch = input.branch;
    if (input.ticket) patch.ticket = input.ticket;
    if (match.state === "dormant") patch.state = "active";
    const updated = await ctx.stores.worksites.update(match.id, patch);
    return updated ?? match;
  }
  return ctx.stores.worksites.create({
    issueKey: input.issueKey,
    issueId: input.ticket?.issueId,
    repoId: input.repoId,
    sessionId,
    accountId: ctx.identity.accountId,
    kind,
    branch: input.branch,
    state: input.state ?? "open",
    openedAt: now,
    lastActivityAt: now,
    ticket: input.ticket,
  });
}

/** Every non-closed worksite of a repo with its footprint entries. */
export async function loadOpenWorksites(
  ctx: Ctx,
  repoId: string,
): Promise<WorksiteWithEntries[]> {
  const worksites = await ctx.stores.worksites.listOpenByRepo(repoId);
  const out: WorksiteWithEntries[] = [];
  for (const worksite of worksites) {
    const entries = await ctx.stores.footprints.listByWorksite(worksite.id);
    out.push({ worksite, entries });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Neighbours                                                          */
/* ------------------------------------------------------------------ */

/** Build neighbour info; actorLabel filled through neighborLabel(locale). */
export async function buildNeighborInfo(
  ctx: Ctx,
  w: Worksite,
  locale: Locale,
  notice?: string,
): Promise<NeighborInfo> {
  const session = w.sessionId
    ? await ctx.stores.sessions.findById(w.sessionId)
    : undefined;
  const info: NeighborInfo = {
    worksiteId: w.id,
    issueKey: w.issueKey,
    accountId: w.accountId,
    actorLabel: "",
    kind: w.kind,
    client: session?.client,
    sessionRef: session?.sessionRef,
    state: w.state,
    lastActivityAt: w.lastActivityAt,
    prOpen: w.prOpen,
    prApproved: w.prApproved,
    branch: w.branch,
    notice,
  };
  info.actorLabel = neighborLabel(info, locale);
  return info;
}

/* ------------------------------------------------------------------ */
/* Verdict assembly                                                    */
/* ------------------------------------------------------------------ */

export interface BuildVerdictArgs {
  subject: Worksite;
  drafts: CollisionDraft[];
  othersById: Map<string, WorksiteWithEntries>;
  zones: Zone[];
  reservations: Reservation[];
  hardMode: boolean;
  locale?: Locale;
  /** Mark pending notices delivered (MCP/hook responses deliver once). */
  deliverNotices?: boolean;
  /** False for read-only probes (check-zone): collisions are NOT persisted. */
  persist?: boolean;
  freezeSuggestion?: { paths: number; zoneName?: string };
}

/** Estimated minutes before the neighbour frees the way. */
function estimateResume(
  reservations: Reservation[],
  neighborId: string,
  neighborPrOpen: boolean | undefined,
  now: string,
): number | undefined {
  const r = reservations.find(
    (x) => x.worksiteId === neighborId && !x.releasedAt && x.expiresAt > now,
  );
  if (r) return Math.max(1, minutesBetween(now, r.expiresAt));
  if (neighborPrOpen) return 15;
  return undefined;
}

/**
 * Upsert collisions, build the VerdictCollisionInfo list, deliver pending
 * notices once, compute the verdict kind and format the text (spec §17
 * steps 5–6). THE single place where a Verdict is assembled.
 */
export async function buildVerdict(ctx: Ctx, args: BuildVerdictArgs): Promise<Verdict> {
  const locale = args.locale ?? "en";
  const now = ctx.now();
  const infos: VerdictCollisionInfo[] = [];

  for (const draft of args.drafts) {
    const collision =
      args.persist === false
        ? { ...draft, id: `probe-${draft.worksiteA}-${draft.worksiteB}-${draft.zoneId ?? ""}`, state: "open" as const, detectedAt: now }
        : await ctx.stores.collisions.upsert(draft);
    const otherId =
      collision.worksiteA === args.subject.id ? collision.worksiteB : collision.worksiteA;
    const other = args.othersById.get(otherId);
    if (!other) continue;
    const sent = await ctx.stores.notices.listByWorksite(otherId);
    const lastNotice = sent.length > 0 ? sent[sent.length - 1] : undefined;
    const neighbor = await buildNeighborInfo(ctx, other.worksite, locale, lastNotice?.text);
    const zone = args.zones.find((z) => z.id === collision.zoneId);
    const nature = zone?.nature ?? "ordinary";

    const reservation = args.reservations.find(
      (r) => r.worksiteId === otherId && !r.releasedAt && r.expiresAt > now,
    );
    const reason = reasonForCollision({
      degree: collision.degree,
      zoneNature: nature,
      zoneName: zone?.name,
      until: reservation?.expiresAt ?? zone?.frozenTo,
      reservedByIssueKey: reservation ? other.worksite.issueKey : undefined,
      locale,
    });
    const advice = adviceForCollision({
      degree: collision.degree,
      zoneNature: nature,
      zoneName: zone?.name,
      neighborIssueKey: other.worksite.issueKey,
      neighborPrOpen: other.worksite.prOpen,
      hardMode: args.hardMode,
      locale,
    });

    infos.push({
      collisionId: collision.id,
      degree: collision.degree,
      zoneName: zone?.name,
      zoneNature: nature,
      path: collision.path,
      neighbor,
      reason,
      advice,
      estimatedResumeMinutes: estimateResume(
        args.reservations,
        otherId,
        other.worksite.prOpen,
        now,
      ),
      sameTicket: other.worksite.issueKey === args.subject.issueKey,
      samePilot: other.worksite.accountId === args.subject.accountId,
      probable: collision.probable,
      hardDeny:
        args.hardMode &&
        collision.degree === 4 &&
        (nature === "exclusive" || nature === "frozen" || reservation !== undefined),
    });
  }

  infos.sort((a, b) => b.degree - a.degree);

  const pendingNotices = await ctx.stores.notices.pendingFor([args.subject.id]);
  if (args.deliverNotices) {
    for (const n of pendingNotices) {
      await ctx.stores.notices.markDelivered(n.noticeId, args.subject.id, now);
    }
  }

  const kind = verdictKindFor(infos, args.hardMode);
  const text = formatVerdictText(
    {
      kind,
      collisions: infos,
      notices: pendingNotices.map((n) => ({ fromIssueKey: n.fromIssueKey, text: n.text })),
    },
    locale,
    now,
  );

  return { kind, collisions: infos, pendingNotices, text, freezeSuggestion: args.freezeSuggestion };
}

/* ------------------------------------------------------------------ */
/* Misc helpers                                                        */
/* ------------------------------------------------------------------ */

export async function logEvent(
  ctx: Ctx,
  kind: string,
  worksiteId?: string,
  payload?: unknown,
): Promise<void> {
  await ctx.stores.events.append({
    at: ctx.now(),
    kind,
    worksiteId,
    payloadJson: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

/** Project rules (order of passage, hard mode, dormancy) with defaults. */
export async function rulesFor(ctx: Ctx) {
  return ctx.stores.rules.get(ctx.projectId);
}
