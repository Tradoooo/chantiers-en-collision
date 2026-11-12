/**
 * services/ingest — hook endpoint logic and CI entry point
 * (CC-05, CC-13, spec §9.3, §10, §17).
 *
 * FAIL-OPEN everywhere: any internal error yields an empty response, the
 * agent keeps working (spec §20 "Ouvert par défaut"). The glue layer is
 * responsible for stripping event content BEFORE calling these functions;
 * only paths, session and cwd arrive here.
 */

import { detectCollisions } from "../core/collisions";

import { entriesFromPaths, mergeEntries } from "../core/footprints";
import { entriesOverlap, classifyPath, normalizePath } from "../core/paths";
import { renderNoticesForAgent } from "../core/notices";
import { adviceForCollision, reasonForCollision } from "../core/verdict";
import { isFrozen, zoneForPath } from "../core/zones";
import type {
  CiFootprintInput,
  HookOpenEvent,
  HookResponse,
  HookTouchEvent,
  RealConflict,
  Worksite,
} from "../core/types";
import type { Ctx } from "./ctx";
import {
  buildVerdict,
  ctxForIssue,
  ensureWorksite,
  loadOpenWorksites,
  logEvent,
  resolveRepo,
  rulesFor,
  splitPathsBlock,
} from "./shared";
import { markActivity } from "./worksites";

const TICKET_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** Absolute client path → repo-relative, using the working dir when given. */
export function relativize(path: string, cwd?: string): string {
  let p = path;
  if (cwd && p.startsWith(cwd)) p = p.slice(cwd.length);
  return normalizePath(p);
}

async function detectAndVerdict(
  ctx: Ctx,
  subject: Worksite,
  repoId: string,
  deliverNotices: boolean,
) {
  const zones = await ctx.stores.zones.listByRepo(repoId);
  const rules = await rulesFor(ctx);
  const now = ctx.now();
  const entries = await ctx.stores.footprints.listByWorksite(subject.id);
  const others = (await loadOpenWorksites(ctx, repoId)).filter(
    (o) => o.worksite.id !== subject.id,
  );
  const reservations = await ctx.stores.reservations.listActive(repoId, now);
  const drafts = detectCollisions({ worksite: subject, entries }, others, {
    zones,
    reservations,
    now,
    hardMode: rules.hardMode,
  });
  return buildVerdict(ctx, {
    subject,
    drafts,
    othersById: new Map(others.map((o) => [o.worksite.id, o])),
    zones,
    reservations,
    hardMode: rules.hardMode,
    deliverNotices,
  });
}

/** SessionStart: open the worksite from the branch, inject the neighbours. */
export async function hookOpen(
  ctx: Ctx,
  ev: HookOpenEvent,
): Promise<{ worksite?: Worksite; response: HookResponse }> {
  try {
    if (!ev.repoSlug) return { response: {} };
    const match = TICKET_KEY.exec(ev.branch);
    if (!match) {
      // Branch without a ticket key: the worksite exists but stays
      // unlinked; the personal panel offers to attach it later (spec §21).
      return {
        response: {
          additionalContext: `No ticket key found in branch "${ev.branch}" — work is visible under your account; link it from the personal panel.`,
        },
      };
    }
    // The hook carries no Jira context: the repo bucket follows the ticket.
    const issueCtx = ctxForIssue(ctx, match[1]!);
    const { repo } = await resolveRepo(issueCtx, ev.repoSlug);
    const w = await ensureWorksite(issueCtx, {
      issueKey: match[1]!,
      repoId: repo.id,
      branch: ev.branch,
      sessionRef: ev.sessionRef,
      state: "open",
    });
    await logEvent(issueCtx, "hook.open", w.id, { branch: ev.branch });
    const verdict = await detectAndVerdict(issueCtx, w, repo.id, true);
    const notices = renderNoticesForAgent(verdict.pendingNotices, "en");
    const neighbours = verdict.collisions
      .map((c) => `${c.neighbor.issueKey} (${c.neighbor.actorLabel}) on ${c.path}`)
      .join("; ");
    const context = [
      neighbours ? `Neighbour worksites on this repo: ${neighbours}.` : "",
      verdict.collisions.length > 0 ? verdict.text : "",
      notices,
    ]
      .filter(Boolean)
      .join("\n");
    return { worksite: w, response: context ? { additionalContext: context } : {} };
  } catch {
    return { response: {} }; // fail-open
  }
}

function hardDenyResponse(ctx: Ctx, reason: string): HookResponse {
  void ctx;
  return { deny: { reason } };
}

/** Record the touched path as OBSERVED evidence (the fact beats the intent). */
async function recordObserved(ctx: Ctx, worksiteId: string, relPath: string): Promise<void> {
  const now = ctx.now();
  const existing = await ctx.stores.footprints.listByWorksite(worksiteId);
  const incoming = entriesFromPaths(relPath, worksiteId, "observed", "edit", now);
  const merged = mergeEntries(existing, incoming, now);
  if (merged.toAdd.length > 0) await ctx.stores.footprints.add(merged.toAdd);
  await markActivity(ctx, worksiteId);
  if (merged.mismatches.length > 0) {
    await logEvent(ctx, "footprint.mismatch", worksiteId, { paths: merged.mismatches });
  }
}

function denyReasonText(
  kind: "frozen" | "reserved",
  zoneName: string,
  until?: string,
  reservedByIssueKey?: string,
): string {
  const reason = reasonForCollision({
    degree: 4,
    zoneNature: kind === "frozen" ? "frozen" : "exclusive",
    zoneName,
    until,
    reservedByIssueKey,
    locale: "en",
  });
  return (
    adviceForCollision({
      degree: 4,
      zoneNature: kind === "frozen" ? "frozen" : "exclusive",
      zoneName,
      neighborIssueKey: reservedByIssueKey ?? "the freeze",
      hardMode: true,
      locale: "en",
    }) + ` (${reason})`
  );
}

/** Hard mode (spec §9.3): deny inside a frozen zone or a foreign hard lock. */
async function hardModeDeny(
  ctx: Ctx,
  worksiteId: string,
  relPath: string,
  repoId: string,
): Promise<HookResponse | undefined> {
  const now = ctx.now();
  const zones = await ctx.stores.zones.listByRepo(repoId);
  const zone = zoneForPath(zones, relPath);
  if (zone && zone.nature === "frozen" && isFrozen(zone, now)) {
    return hardDenyResponse(ctx, denyReasonText("frozen", zone.name, zone.frozenTo));
  }
  const reservations = await ctx.stores.reservations.listActive(repoId, now);
  const kind = classifyPath(relPath);
  const blocking = reservations.find(
    (r) =>
      r.hard &&
      r.worksiteId !== worksiteId &&
      r.patterns.some((p) => entriesOverlap(p, classifyPath(p), relPath, kind)),
  );
  if (!blocking) return undefined;
  const owner = await ctx.stores.worksites.findById(blocking.worksiteId);
  return hardDenyResponse(
    ctx,
    denyReasonText("reserved", blocking.patterns[0] ?? relPath, blocking.expiresAt, owner?.issueKey),
  );
}

/** PreToolUse: the path enters the OBSERVED footprint; warn or deny. */
export async function hookTouch(ctx: Ctx, ev: HookTouchEvent): Promise<HookResponse> {
  try {
    if (!ev.repoSlug || !ev.path) return {};
    const session = await ctx.stores.sessions.findByRef(
      ctx.identity.accountId,
      ev.sessionRef,
      ev.agentRef ?? ctx.identity.agentRef,
    );
    if (!session) return {}; // unknown session — SessionStart never ran
    const w = await ctx.stores.worksites.findBySession(session.id);
    if (!w || w.state === "closed") return {};

    // Rules and detection read the project bucket of the TICKET, not the
    // webtrigger default: the worksite carries its issueKey.
    const issueCtx = ctxForIssue(ctx, w.issueKey);
    const rel = relativize(ev.path, ev.cwd);
    await recordObserved(issueCtx, w.id, rel);

    const rules = await rulesFor(issueCtx);
    if (rules.hardMode) {
      const denied = await hardModeDeny(issueCtx, w.id, rel, w.repoId);
      if (denied) return denied;
    }

    const fresh = (await issueCtx.stores.worksites.findById(w.id)) ?? w;
    const verdict = await detectAndVerdict(issueCtx, fresh, w.repoId, true);
    if (verdict.collisions.length === 0 && verdict.pendingNotices.length === 0) {
      return {};
    }
    const noticeText = renderNoticesForAgent(verdict.pendingNotices, "en");
    const context = [verdict.collisions.length > 0 ? verdict.text : "", noticeText]
      .filter(Boolean)
      .join("\n");
    return context ? { additionalContext: context } : {};
  } catch {
    return {}; // fail-open: the agent continues (spec §22.11)
  }
}

/** SessionEnd: pause the worksite (best effort; dormancy is the safety net). */
export async function hookClose(
  ctx: Ctx,
  ev: { sessionRef: string; reason?: string },
): Promise<void> {
  try {
    const session = await ctx.stores.sessions.findByRef(
      ctx.identity.accountId,
      ev.sessionRef,
      ctx.identity.agentRef,
    );
    if (!session) return;
    const w = await ctx.stores.worksites.findBySession(session.id);
    if (!w || w.state === "closed") return;
    await ctx.stores.worksites.update(w.id, {
      state: w.prOpen ? "review" : "paused",
      lastActivityAt: ctx.now(),
    });
    await logEvent(ctx, "hook.close", w.id, { reason: ev.reason });
  } catch {
    // fail-open
  }
}

/** CI: the branch file list becomes the ATTESTED footprint (spec §10). */
export async function ciFootprint(
  ctx: Ctx,
  input: CiFootprintInput,
): Promise<{ worksite?: Worksite; entries: number }> {
  const issueKey = input.issueKey ?? TICKET_KEY.exec(input.branch)?.[1];
  if (!issueKey) {
    // Push on a branch without a ticket key: nothing to attach to.
    return { entries: 0 };
  }
  const issueCtx = ctxForIssue(ctx, issueKey);
  const { repo } = await resolveRepo(issueCtx, input.repoSlug);
  const now = issueCtx.now();
  const w = await ensureWorksite(issueCtx, {
    issueKey,
    repoId: repo.id,
    branch: input.branch,
    kind: "human",
    client: "ci",
    state: input.prOpen ? "review" : "open",
  });

  const files = splitPathsBlock(input.files.join("\n"));
  const existing = await issueCtx.stores.footprints.listByWorksite(w.id);
  const incoming = entriesFromPaths(files.join("\n"), w.id, "attested", "edit", now);
  const merged = mergeEntries(existing, incoming, now);
  if (merged.toAdd.length > 0) await issueCtx.stores.footprints.add(merged.toAdd);

  const patch: Partial<Worksite> = { lastActivityAt: now };
  if (input.prOpen) {
    patch.state = "review";
    patch.prOpen = true;
    patch.prApproved = input.prApproved ?? false;
  }
  const onDefault = input.branch === repo.defaultBranch;
  if (onDefault) {
    patch.state = "closed";
    patch.closedAt = now;
    patch.outcome = "merged";
  }
  const updated = (await issueCtx.stores.worksites.update(w.id, patch)) ?? w;
  await logEvent(issueCtx, "ci.footprint", w.id, { files: files.length, onDefault });

  if (!onDefault) {
    await detectAndVerdict(issueCtx, updated, repo.id, false);
  }
  return { worksite: updated, entries: merged.toAdd.length };
}

/** A real merge/rebase conflict: did the app see it coming? (spec §13) */
export async function reportConflict(
  ctx: Ctx,
  input: { issueKey: string; repoSlug: string; paths: string; withIssueKey?: string },
): Promise<RealConflict> {
  const { repo } = await resolveRepo(ctx, input.repoSlug);
  const now = ctx.now();
  const paths = splitPathsBlock(input.paths);

  const mine = (await ctx.stores.worksites.findByIssue(input.issueKey, repo.id))[0];
  const theirs = input.withIssueKey
    ? (await ctx.stores.worksites.findByIssue(input.withIssueKey, repo.id))[0]
    : undefined;

  let wasDetected = false;
  if (mine && theirs) {
    const existing = await ctx.stores.collisions.listByWorksite(mine.id, false);
    wasDetected = existing.some(
      (c) =>
        (c.worksiteA === theirs.id || c.worksiteB === theirs.id) &&
        (paths.length === 0 ||
          paths.some((p) => entriesOverlap(c.path, classifyPath(c.path), p, classifyPath(p)))),
    );
  } else if (mine) {
    const entries = await ctx.stores.footprints.listByWorksite(mine.id);
    wasDetected = entries.some((e) =>
      paths.some((p) => entriesOverlap(e.path, e.kind, p, classifyPath(p))),
    );
  }

  const conflict = await ctx.stores.conflicts.report({
    repoId: repo.id,
    worksiteA: mine?.id,
    worksiteB: theirs?.id,
    issueKeyA: input.issueKey,
    issueKeyB: input.withIssueKey,
    paths,
    wasDetected,
    reportedAt: now,
  });
  await logEvent(ctx, "conflict.reported", mine?.id, { wasDetected, paths });
  return conflict;
}
