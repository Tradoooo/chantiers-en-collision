/**
 * services/worksites — open/pause/close/panel/who-touches (CC-01, CC-09).
 * Closing releases neighbours waiting on the freed ground: their collisions
 * are retired and their next call answers "free" (spec §8 "Attendre").
 */

import { entriesOverlap, classifyPath } from "../core/paths";
import { coverageOf } from "../core/footprints";
import type {
  ActorKind,
  FootprintEntry,
  FootprintSource,
  NeighborInfo,
  TicketMeta,
  Worksite,
  WorksiteOutcome,
  WorksitePanel,
} from "../core/types";
import type { Ctx } from "./ctx";
import {
  buildNeighborInfo,
  ensureWorksite,
  loadOpenWorksites,
  logEvent,
  resolveRepo,
} from "./shared";

export interface OpenInput {
  issueKey: string;
  repoSlug: string;
  branch?: string;
  sessionRef?: string;
  kind?: ActorKind;
  ticket?: TicketMeta;
}

export async function openWorksite(ctx: Ctx, input: OpenInput): Promise<Worksite> {
  const { repo } = await resolveRepo(ctx, input.repoSlug);
  let ticket = input.ticket;
  if (!ticket && ctx.jira) {
    ticket = (await ctx.jira.getIssue(input.issueKey)) ?? undefined;
  }
  const w = await ensureWorksite(ctx, {
    issueKey: input.issueKey,
    repoId: repo.id,
    branch: input.branch,
    sessionRef: input.sessionRef,
    kind: input.kind,
    ticket,
    state: "open",
  });
  await logEvent(ctx, "worksite.opened", w.id, { issueKey: w.issueKey });
  return w;
}

async function findBySessionOrIssue(
  ctx: Ctx,
  input: { sessionRef?: string; issueKey?: string; repoSlug?: string },
): Promise<Worksite | undefined> {
  if (input.sessionRef) {
    const session = await ctx.stores.sessions.findByRef(
      ctx.identity.accountId,
      input.sessionRef,
      ctx.identity.agentRef,
    );
    if (session) {
      const w = await ctx.stores.worksites.findBySession(session.id);
      if (w) return w;
    }
  }
  if (input.issueKey) {
    if (input.repoSlug) {
      const { repo } = await resolveRepo(ctx, input.repoSlug);
      const list = await ctx.stores.worksites.findByIssue(input.issueKey, repo.id);
      return list[0];
    }
    const list = await ctx.stores.worksites.findByIssue(input.issueKey);
    return list[0];
  }
  return undefined;
}

/** Session end / branch pushed without PR → paused (review if a PR is open). */
export async function pauseWorksite(
  ctx: Ctx,
  input: { sessionRef?: string; issueKey?: string; repoSlug?: string },
): Promise<Worksite | undefined> {
  const w = await findBySessionOrIssue(ctx, input);
  if (!w || w.state === "closed") return undefined;
  const updated = await ctx.stores.worksites.update(w.id, {
    state: w.prOpen ? "review" : "paused",
    lastActivityAt: ctx.now(),
  });
  await logEvent(ctx, "worksite.paused", w.id);
  return updated;
}

export interface CloseInput {
  issueKey: string;
  repoSlug?: string;
  session?: string;
  outcome?: WorksiteOutcome;
}

/** Retire the open collisions of a closed worksite; return freed neighbours. */
async function releaseNeighbours(ctx: Ctx, closed: Worksite): Promise<NeighborInfo[]> {
  const released: NeighborInfo[] = [];
  const collisions = await ctx.stores.collisions.listByWorksite(closed.id, true);
  for (const c of collisions) {
    const otherId = c.worksiteA === closed.id ? c.worksiteB : c.worksiteA;
    await ctx.stores.collisions.resolve(c.id, undefined, "system", "neighbour worksite closed");
    const other = await ctx.stores.worksites.findById(otherId);
    if (other && other.state !== "closed") {
      released.push(await buildNeighborInfo(ctx, other, "en"));
    }
  }
  return released;
}

export async function closeWorksite(
  ctx: Ctx,
  input: CloseInput,
): Promise<{ closed: Worksite[]; released: NeighborInfo[] }> {
  const now = ctx.now();
  const outcome = input.outcome ?? "merged";
  let candidates: Worksite[] = await ctx.stores.worksites.findByIssue(
    input.issueKey,
    input.repoSlug ? (await resolveRepo(ctx, input.repoSlug)).repo.id : undefined,
  );
  if (input.session) {
    const session = await ctx.stores.sessions.findByRef(
      ctx.identity.accountId,
      input.session,
      ctx.identity.agentRef,
    );
    if (session) candidates = candidates.filter((w) => w.sessionId === session.id);
  }
  const closed: Worksite[] = [];
  const released: NeighborInfo[] = [];
  for (const w of candidates) {
    const done = await ctx.stores.worksites.update(w.id, {
      state: "closed",
      closedAt: now,
      outcome,
    });
    if (done) closed.push(done);
    await logEvent(ctx, "worksite.closed", w.id, { outcome });
    released.push(...(await releaseNeighbours(ctx, w)));
  }
  return { closed, released };
}

/** Record activity: refreshes lastActivityAt; dormant/paused/open → active. */
export async function markActivity(ctx: Ctx, worksiteId: string): Promise<void> {
  const w = await ctx.stores.worksites.findById(worksiteId);
  if (!w || w.state === "closed") return;
  const state =
    w.state === "dormant" || w.state === "paused" || w.state === "open" || w.state === "planned"
      ? "active"
      : w.state;
  await ctx.stores.worksites.update(worksiteId, {
    lastActivityAt: ctx.now(),
    state,
  });
}

/** Panel data for a ticket: everything of spec §16.1, per repository. */
export async function getWorksitePanel(ctx: Ctx, issueKey: string): Promise<WorksitePanel> {
  const now = ctx.now();
  const mine = await ctx.stores.worksites.findByIssue(issueKey);
  const byRepo = new Map<string, Worksite[]>();
  for (const w of mine) {
    const list = byRepo.get(w.repoId) ?? [];
    list.push(w);
    byRepo.set(w.repoId, list);
  }
  const repos: WorksitePanel["repos"] = [];
  for (const [repoId, worksites] of byRepo) {
    const repo = await ctx.stores.repos.findById(repoId);
    if (!repo) continue;
    const footprintsBySource = {} as Record<FootprintSource, FootprintEntry[]>;
    for (const src of ["predicted", "declared", "observed", "attested"] as FootprintSource[]) {
      footprintsBySource[src] = [];
    }
    const allEntries: FootprintEntry[] = [];
    const neighbors: NeighborInfo[] = [];
    const collisions = [];
    const inbox = [];
    const sent = [];
    const reservations = [];
    for (const w of worksites) {
      const entries = await ctx.stores.footprints.listByWorksite(w.id);
      allEntries.push(...entries);
      for (const c of await ctx.stores.collisions.listByWorksite(w.id)) collisions.push(c);
      inbox.push(...(await ctx.stores.notices.pendingFor([w.id])));
      sent.push(...(await ctx.stores.notices.listByWorksite(w.id)));
      reservations.push(...(await ctx.stores.reservations.listByWorksite(w.id, now)));
      const neighborIds = collisions
        .map((c) => (c.worksiteA === w.id ? c.worksiteB : c.worksiteA))
        .filter((id) => !worksites.some((x) => x.id === id));
      for (const id of new Set(neighborIds)) {
        const other = await ctx.stores.worksites.findById(id);
        if (other && other.state !== "closed") {
          neighbors.push(await buildNeighborInfo(ctx, other, "en"));
        }
      }
    }
    for (const e of allEntries) footprintsBySource[e.source].push(e);
    repos.push({
      repo,
      worksites,
      footprintsBySource,
      coverage: coverageOf(allEntries),
      neighbors,
      collisions,
      noticesInbox: inbox,
      noticesSent: sent,
      reservations,
    });
  }
  return { issueKey, repos };
}

/** Worksites present on a path right now, with state and last activity. */
export async function whoTouches(
  ctx: Ctx,
  input: { repoSlug: string; path: string },
): Promise<NeighborInfo[]> {
  const { repo } = await resolveRepo(ctx, input.repoSlug);
  const kind = classifyPath(input.path);
  const open = await loadOpenWorksites(ctx, repo.id);
  const out: NeighborInfo[] = [];
  for (const side of open) {
    const hit = side.entries.some((e) => entriesOverlap(e.path, e.kind, input.path, kind));
    if (hit) out.push(await buildNeighborInfo(ctx, side.worksite, "en"));
  }
  return out;
}
