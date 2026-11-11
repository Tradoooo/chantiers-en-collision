/**
 * services/shared — plumbing shared by every service.
 * Owner: orchestrator. FROZEN: do not modify; report gaps instead.
 *
 * Pure orchestration over Stores + core/*; no @forge/* import here.
 */

import type {
  ActorKind,
  ActorSession,
  Collision,
  CollisionDraft,
  Degree,
  Locale,
  NeighborInfo,
  NoticeView,
  RepoRecord,
  Reservation,
  TicketMeta,
  Verdict,
  VerdictCollisionInfo,
  Worksite,
  WorksiteState,
  Zone,
  ZoneNature,
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
/** Last notice posted by a worksite, shown as "neighbor's notice". */
async function lastNoticeOf(ctx: Ctx, worksiteId: string): Promise<string | undefined> {
  const sent = await ctx.stores.notices.listByWorksite(worksiteId);
  return sent.length > 0 ? sent[sent.length - 1]?.text : undefined;
}

interface WordingInput {
  degree: Degree;
  nature: ZoneNature;
  zoneName?: string;
  until?: string;
  reservedByIssueKey?: string;
  neighborIssueKey: string;
  neighborPrOpen?: boolean;
  hardMode: boolean;
  locale: Locale;
}

/** The "reason" and "what to do" lines of a collision (spec §8). */
function wordingFor(w: WordingInput): { reason: string; advice: string } {
  return {
    reason: reasonForCollision({
      degree: w.degree,
      zoneNature: w.nature,
      zoneName: w.zoneName,
      until: w.until,
      reservedByIssueKey: w.reservedByIssueKey,
      locale: w.locale,
    }),
    advice: adviceForCollision({
      degree: w.degree,
      zoneNature: w.nature,
      zoneName: w.zoneName,
      neighborIssueKey: w.neighborIssueKey,
      neighborPrOpen: w.neighborPrOpen,
      hardMode: w.hardMode,
      locale: w.locale,
    }),
  };
}

/** Build one VerdictCollisionInfo from an upserted (or probe) collision. */
async function collisionInfoFor(
  ctx: Ctx,
  args: BuildVerdictArgs,
  collision: Collision,
  locale: Locale,
  now: string,
): Promise<VerdictCollisionInfo | undefined> {
  const otherId =
    collision.worksiteA === args.subject.id ? collision.worksiteB : collision.worksiteA;
  const other = args.othersById.get(otherId);
  if (!other) return undefined;
  const neighbor = await buildNeighborInfo(
    ctx,
    other.worksite,
    locale,
    await lastNoticeOf(ctx, otherId),
  );
  const zone = args.zones.find((z) => z.id === collision.zoneId);
  const nature = zone?.nature ?? "ordinary";
  const reservation = args.reservations.find(
    (r) => r.worksiteId === otherId && !r.releasedAt && r.expiresAt > now,
  );
  const { reason, advice } = wordingFor({
    degree: collision.degree,
    nature,
    zoneName: zone?.name,
    until: reservation?.expiresAt ?? zone?.frozenTo,
    reservedByIssueKey: reservation ? other.worksite.issueKey : undefined,
    neighborIssueKey: other.worksite.issueKey,
    neighborPrOpen: other.worksite.prOpen,
    hardMode: args.hardMode,
    locale,
  });
  return assembleInfo({ args, collision, other: other.worksite, neighbor, zone, nature, reservation, reason, advice, otherId, now });
}

interface AssembleParts {
  args: BuildVerdictArgs;
  collision: Collision;
  other: Worksite;
  neighbor: NeighborInfo;
  zone?: Zone;
  nature: ZoneNature;
  reservation?: Reservation;
  reason: string;
  advice: string;
  otherId: string;
  now: string;
}

/** Final shape of one collision line of the verdict. */
function assembleInfo(p: AssembleParts): VerdictCollisionInfo {
  return {
    collisionId: p.collision.id,
    degree: p.collision.degree,
    zoneName: p.zone?.name,
    zoneNature: p.nature,
    path: p.collision.path,
    neighbor: p.neighbor,
    reason: p.reason,
    advice: p.advice,
    estimatedResumeMinutes: estimateResume(
      p.args.reservations,
      p.otherId,
      p.other.prOpen,
      p.now,
    ),
    sameTicket: p.other.issueKey === p.args.subject.issueKey,
    samePilot: p.other.accountId === p.args.subject.accountId,
    probable: p.collision.probable,
    hardDeny:
      p.args.hardMode &&
      p.collision.degree === 4 &&
      (p.nature === "exclusive" || p.nature === "frozen" || p.reservation !== undefined),
  };
}

/** Pending notices for the subject, marked delivered when asked (once each). */
async function pendingForSubject(
  ctx: Ctx,
  subjectId: string,
  deliver: boolean,
): Promise<NoticeView[]> {
  const pending = await ctx.stores.notices.pendingFor([subjectId]);
  if (deliver) {
    for (const n of pending) {
      await ctx.stores.notices.markDelivered(n.noticeId, subjectId, ctx.now());
    }
  }
  return pending;
}

/**
 * Upsert collisions, build the VerdictCollisionInfo list, deliver pending
 * notices once, compute the verdict kind and format the text (spec §17
 * steps 5-6). THE single place where a Verdict is assembled.
 */
export async function buildVerdict(ctx: Ctx, args: BuildVerdictArgs): Promise<Verdict> {
  const locale = args.locale ?? "en";
  const now = ctx.now();
  const infos: VerdictCollisionInfo[] = [];

  for (const draft of args.drafts) {
    const collision: Collision =
      args.persist === false
        ? {
            ...draft,
            id: `probe-${draft.worksiteA}-${draft.worksiteB}-${draft.zoneId ?? ""}`,
            state: "open",
            detectedAt: now,
          }
        : await ctx.stores.collisions.upsert(draft);
    const info = await collisionInfoFor(ctx, args, collision, locale, now);
    if (info) infos.push(info);
  }

  infos.sort((a, b) => b.degree - a.degree);
  const pendingNotices = await pendingForSubject(
    ctx,
    args.subject.id,
    args.deliverNotices === true,
  );
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
