/**
 * glue/triggers — the three non-UI entry points of the manifest:
 *   trigger          `issue-events`      (avi:jira:created:issue, avi:jira:updated:issue)
 *   scheduledTrigger `five-minute-sweep` (dormancy, expirations — spec §11)
 *   scheduledTrigger `daily-jobs`       (predictions, accuracy — spec §12, §13)
 *   jira:jqlFunction `collidingWork()` / `collidesWith("PROJ-88")`
 * Owner: workstream I (glue). Collaborators are injectable (deps) so the
 * routing is testable without Forge.
 *
 * DECISIONS (documented best effort):
 *  - No user context: Forge invokes triggers and scheduled jobs without a user,
 *    so the identity is the synthetic `system` account and never an input
 *    (spec §9.6). The issue creator is NOT trusted as the pilot either.
 *  - Repository of an issue event: the event carries no repository, so the
 *    project's first registered repository is used (the panel and the tools
 *    cover every repository of the project). No repository → nothing to do.
 *  - Status: `avi:jira:updated:issue` carries the CURRENT issue, no changelog,
 *    so the trigger acts on the current status category (indeterminate → open
 *    the worksite, done → close it with outcome "done"). Both calls are
 *    idempotent; the five-minute sweep is the safety net.
 *  - Projects for the scheduled jobs: the stores have no "list projects", so
 *    the project keys are derived from the issue keys of the non-closed
 *    worksites (`listIdleBefore(now)` returns every non-closed worksite).
 *  - JQL functions return a JQL PREDICATE (Forge combines it with the clause):
 *    `issuekey in (A, B)`, capped at 200 keys. With nothing to return the
 *    predicate matches no issue (`EMPTY_JQL`) — an empty list is not valid JQL.
 */

import type { TicketMeta } from "../core/types";
import type { Ctx } from "../services/ctx";
import { dailyJobs as dailyJobsService, sweep as sweepService, type SweepResult } from "../services/maintenance";
import { ensureWorksite } from "../services/shared";
import { closeWorksite, openWorksite } from "../services/worksites";
import {
  buildCtx,
  DEFAULT_PROJECT_ID,
  projectOfIssueKey,
  type BuildCtxOptions,
  type ForgeInvocationContext,
} from "../forge-context";
import { toTicketMeta } from "./jira-port";
import {
  predictionFor as predictionForService,
  predictionRepo,
  storePredictedFootprint as storePredictedFootprintService,
} from "./prediction";
import type { PredictionLookup } from "./prediction";
import type { FootprintPrediction } from "../core/types";

/** Payload of a Jira product event: `{ events: [{ eventType, issue }] }`. */
export interface JiraIssueEvent {
  eventType?: string;
  issue?: unknown;
}

export interface TriggerEvent {
  events?: JiraIssueEvent[];
  issue?: unknown;
  eventType?: string;
}

/** What a `jira:jqlFunction` handler must return. */
export interface JqlResult {
  jql: string;
}

export interface TriggerDeps {
  buildCtx(options: BuildCtxOptions): Promise<Ctx>;
  ensureWorksite: typeof ensureWorksite;
  openWorksite: typeof openWorksite;
  closeWorksite: typeof closeWorksite;
  sweep: typeof sweepService;
  dailyJobs: typeof dailyJobsService;
  predictionFor(ctx: Ctx, issueKey: string): Promise<PredictionLookup>;
  storePredictedFootprint(
    ctx: Ctx,
    worksiteId: string,
    prediction: FootprintPrediction,
  ): Promise<number>;
}

export const LIVE_TRIGGER_DEPS: TriggerDeps = {
  buildCtx,
  ensureWorksite,
  openWorksite,
  closeWorksite,
  sweep: sweepService,
  dailyJobs: dailyJobsService,
  predictionFor: predictionForService,
  storePredictedFootprint: storePredictedFootprintService,
};

/** Predicate matching nothing: an empty `in ()` list is not valid JQL. */
export const EMPTY_JQL = 'summary = "__chantiers_none__"';
const MAX_JQL_KEYS = 200;
const MAX_PROJECTS = 20;

/* ------------------------------------------------------------------ */
/* Small untyped-payload helpers                                        */
/* ------------------------------------------------------------------ */

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Status category of an event issue: "new" | "indeterminate" | "done". */
function statusCategoryOf(issue: unknown): string | undefined {
  const status = rec(rec(issue).fields).status;
  const category = text(rec(status).statusCategory ? rec(rec(status).statusCategory).key : undefined);
  if (category !== undefined) return category;
  const name = text(rec(status).name)?.toLowerCase();
  if (name === undefined) return undefined;
  if (/(done|closed|resolved|terminé|clôturé)/.test(name)) return "done";
  if (/(progress|cours)/.test(name)) return "indeterminate";
  return "new";
}

function isCreated(eventType?: string): boolean {
  return eventType !== undefined && /created/i.test(eventType);
}

/** Flatten the event payload: Forge batches events, but be tolerant. */
function issueEventsOf(event: unknown): JiraIssueEvent[] {
  const payload = rec(event);
  const batch = Array.isArray(payload.events) ? (payload.events as JiraIssueEvent[]) : [];
  if (batch.length > 0) return batch;
  if (payload.issue !== undefined) return [{ eventType: text(payload.eventType), issue: payload.issue }];
  return [];
}

/* ------------------------------------------------------------------ */
/* trigger: issue-events                                                */
/* ------------------------------------------------------------------ */

/** Ticket created → a PLANNED worksite + its predicted footprint (spec §10). */
async function plannedWorksite(
  ctx: Ctx,
  ticket: TicketMeta,
  repoId: string,
  deps: TriggerDeps,
): Promise<void> {
  const worksite = await deps.ensureWorksite(ctx, {
    issueKey: ticket.issueKey,
    repoId,
    kind: "human",
    state: "planned",
    ticket,
  });
  const lookup = await deps.predictionFor(ctx, ticket.issueKey);
  if (lookup.prediction === undefined) return;
  await deps.storePredictedFootprint(ctx, worksite.id, lookup.prediction);
}

async function handleIssue(
  issue: unknown,
  eventType: string | undefined,
  context: ForgeInvocationContext | undefined,
  deps: TriggerDeps,
): Promise<void> {
  const ticket = toTicketMeta(issue);
  if (ticket.issueKey === "") return;
  const ctx = await deps.buildCtx({ context, client: "trigger", issueKey: ticket.issueKey, kind: "human" });
  const repo = await predictionRepo(ctx);
  if (repo === undefined) return; // no repository registered for this project
  if (isCreated(eventType)) {
    await plannedWorksite(ctx, ticket, repo.id, deps);
    return;
  }
  const category = statusCategoryOf(issue);
  if (category === "done") {
    await deps.closeWorksite(ctx, { issueKey: ticket.issueKey, outcome: "done" });
    return;
  }
  if (category === "indeterminate") {
    await deps.openWorksite(ctx, {
      issueKey: ticket.issueKey,
      repoSlug: repo.slug,
      kind: "human",
      ticket,
    });
  }
}

/** `trigger` handler: one invocation carries one or more issue events. */
export async function issueEvents(
  event: unknown,
  context?: ForgeInvocationContext,
  deps: TriggerDeps = LIVE_TRIGGER_DEPS,
): Promise<void> {
  for (const entry of issueEventsOf(event)) {
    await handleIssue(entry.issue, entry.eventType, context, deps);
  }
}

/* ------------------------------------------------------------------ */
/* scheduledTrigger: five-minute-sweep / daily-jobs                     */
/* ------------------------------------------------------------------ */

/** Every non-closed worksite: the only global listing the stores offer. */
async function openWorksites(ctx: Ctx) {
  return ctx.stores.worksites.listIdleBefore(ctx.now());
}

/** Project keys seen in the worksite table (no "list projects" in the stores). */
export async function projectIdsOf(ctx: Ctx): Promise<string[]> {
  const ids = new Set<string>();
  for (const worksite of await openWorksites(ctx)) {
    const projectId = projectOfIssueKey(worksite.issueKey);
    if (projectId !== undefined) ids.add(projectId);
  }
  if (ids.size === 0) ids.add(DEFAULT_PROJECT_ID);
  return [...ids].slice(0, MAX_PROJECTS);
}

/** Run one maintenance job for every project, with that project's rules. */
async function perProject<R>(
  context: ForgeInvocationContext | undefined,
  client: string,
  deps: TriggerDeps,
  job: (ctx: Ctx) => Promise<R>,
): Promise<R[]> {
  const probe = await deps.buildCtx({ context, client });
  const results: R[] = [];
  for (const projectId of await projectIdsOf(probe)) {
    const ctx = await deps.buildCtx({ context, client, projectId });
    results.push(await job(ctx));
  }
  return results;
}

/** fiveMinute: dormancy, auto-close, expired reservations (spec §11). */
export async function sweepFiveMinute(
  _event?: unknown,
  context?: ForgeInvocationContext,
  deps: TriggerDeps = LIVE_TRIGGER_DEPS,
): Promise<SweepResult[]> {
  return perProject(context, "scheduled-sweep", deps, (ctx) => deps.sweep(ctx));
}

/** day: refresh predictions, compare predicted vs attested (spec §12, §13). */
export async function dailyJobs(
  _event?: unknown,
  context?: ForgeInvocationContext,
  deps: TriggerDeps = LIVE_TRIGGER_DEPS,
): Promise<{ predictions: number; accuracyComputed: number }[]> {
  return perProject(context, "scheduled-daily", deps, (ctx) => deps.dailyJobs(ctx));
}

/* ------------------------------------------------------------------ */
/* jira:jqlFunction: collidingWork() / collidesWith(issueKey)           */
/* ------------------------------------------------------------------ */

/** `issuekey in (…)` predicate, or EMPTY_JQL when there is nothing to return. */
export function jqlForKeys(issueKeys: string[]): string {
  const keys = [...new Set(issueKeys)].slice(0, MAX_JQL_KEYS);
  return keys.length === 0 ? EMPTY_JQL : `issuekey in (${keys.join(", ")})`;
}

/** First argument of the JQL clause, tolerant to the resolver payload shape. */
export function clauseArgument(args: unknown): string | undefined {
  const payload = rec(args);
  const clause = rec(payload.clause);
  const list = Array.isArray(clause.arguments) ? clause.arguments : [];
  return (
    text(list[0]) ?? text(rec(list[0]).value) ?? text(payload.issueKey) ?? text(rec(payload.payload).issueKey)
  );
}

async function repoIdsOf(ctx: Ctx): Promise<string[]> {
  const ids = new Set<string>();
  for (const worksite of await openWorksites(ctx)) ids.add(worksite.repoId);
  return [...ids];
}

/** Issue keys carrying at least one OPEN collision, whatever the repository. */
export async function collidingIssueKeys(ctx: Ctx): Promise<string[]> {
  const keys: string[] = [];
  for (const repoId of await repoIdsOf(ctx)) {
    for (const collision of await ctx.stores.collisions.listByRepo(repoId, true)) {
      for (const worksiteId of [collision.worksiteA, collision.worksiteB]) {
        const worksite = await ctx.stores.worksites.findById(worksiteId);
        if (worksite !== undefined) keys.push(worksite.issueKey);
      }
    }
  }
  return keys;
}

/** `issue in collidingWork()` — tickets with at least one open collision. */
export async function jqlCollidingWork(
  _args?: unknown,
  context?: ForgeInvocationContext,
  deps: TriggerDeps = LIVE_TRIGGER_DEPS,
): Promise<JqlResult> {
  const ctx = await deps.buildCtx({ context, client: "jql" });
  return { jql: jqlForKeys(await collidingIssueKeys(ctx)) };
}

/** `issue in collidesWith("PROJ-88")` — tickets in open collision with it. */
export async function jqlCollidesWith(
  args?: unknown,
  context?: ForgeInvocationContext,
  deps: TriggerDeps = LIVE_TRIGGER_DEPS,
): Promise<JqlResult> {
  const issueKey = clauseArgument(args);
  if (issueKey === undefined) return { jql: EMPTY_JQL };
  const ctx = await deps.buildCtx({ context, client: "jql", issueKey });
  const keys: string[] = [];
  for (const worksite of await ctx.stores.worksites.findByIssue(issueKey)) {
    for (const collision of await ctx.stores.collisions.listByWorksite(worksite.id, true)) {
      const otherId = collision.worksiteA === worksite.id ? collision.worksiteB : collision.worksiteA;
      const other = await ctx.stores.worksites.findById(otherId);
      if (other !== undefined && other.issueKey !== issueKey) keys.push(other.issueKey);
    }
  }
  return { jql: jqlForKeys(keys) };
}
