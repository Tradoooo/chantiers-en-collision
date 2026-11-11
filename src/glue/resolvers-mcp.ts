/**
 * glue/resolvers-mcp — one function per MCP tool (spec §15), 13 of them.
 * Owner: workstream I (glue). Each handler:
 *   1. parses the payload (simple values only: `paths` is one path per line),
 *   2. builds the Ctx — identity from the Forge context, NEVER from an input
 *      (spec §9.6); the `session` input only distinguishes sessions,
 *   3. calls the matching service,
 *   4. returns a JSON-serializable `{ verdict?…, text }` (the text is what the
 *      agent reads, the rest is what a UI or an orchestrator can use).
 *
 * The registry at the bottom maps BOTH the tool keys of manifest.yml
 * (`declare-footprint`) and the function module keys (`declareFootprint`), so
 * the same handler answers however the platform routes the call.
 */

import type { Collision, Locale, Verdict } from "../core/types";
import type { Ctx } from "../services/ctx";
import { checkZone, declareFootprint } from "../services/declare";
import { reportConflict } from "../services/ingest";
import { listClearWork, listCollisions, nextClearTicket, planParallelWork } from "../services/planning";
import { measureParallelWidth } from "../services/width";
import { postNotice } from "../services/notices";
import { reserveZone } from "../services/reservations";
import { resolveCollision } from "../services/resolve";
import { buildNeighborInfo } from "../services/shared";
import { closeWorksite, getWorksitePanel, whoTouches } from "../services/worksites";
import { predictionFor } from "./prediction";
import {
  closeText,
  collisionsText,
  conflictText,
  neighborsText,
  noticeText,
  panelText,
  predictionText,
  reservationText,
  resolutionText,
  ticketsText,
  wavePlanText,
  type CollisionRow,
} from "./tool-text";

/* Shared parsing / identity / Ctx helpers live in ./tool-helpers (split for
 * the <500-lines rule); re-exported so existing imports keep working. */
import {
  CHOICES,
  int,
  localeOf,
  MAX_COLLISION_ROWS,
  MODES,
  oneOf,
  OUTCOMES,
  paths,
  payloadOf,
  required,
  str,
  ToolInputError,
  toolCtx,
} from "./tool-helpers";
import type { ToolHandler, ToolRequest, ToolResult } from "./tool-helpers";

export {
  int,
  MCP_DEPS,
  paths,
  required,
  str,
  ToolInputError,
  type McpDeps,
  type ToolHandler,
  type ToolPayload,
  type ToolRequest,
  type ToolResult,
} from "./tool-helpers";

function verdictResult(tool: string, verdict: Verdict): ToolResult {
  const result: ToolResult = {
    tool,
    verdict: verdict.kind,
    text: verdict.text,
    collisions: verdict.collisions,
    pendingNotices: verdict.pendingNotices,
  };
  if (verdict.freezeSuggestion !== undefined) result.freezeSuggestion = verdict.freezeSuggestion;
  return result;
}

/* ------------------------------------------------------------------ */
/* The 13 tools                                                         */
/* ------------------------------------------------------------------ */

export async function declareFootprintTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const issueKey = required(payload, "issueKey");
  const repoSlug = required(payload, "repo");
  const session = str(payload, "session");
  const locale = localeOf(payload);
  const ctx = await toolCtx(request, { issueKey, sessionRef: session });
  const verdict = await declareFootprint(ctx, {
    issueKey,
    repoSlug,
    paths: paths(payload),
    mode: oneOf(payload, "mode", MODES),
    etaMinutes: int(payload, "etaMinutes"),
    session,
    locale,
  });
  return verdictResult("declare-footprint", verdict);
}

export async function checkZoneTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const repoSlug = required(payload, "repo");
  const ctx = await toolCtx(request, { issueKey: str(payload, "issueKey"), repoSlug });
  const verdict = await checkZone(ctx, {
    repoSlug,
    paths: paths(payload),
    issueKey: str(payload, "issueKey"),
    locale: localeOf(payload),
  });
  return verdictResult("check-zone", verdict);
}

export async function whoTouchesTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const repoSlug = required(payload, "repo");
  const path = required(payload, "path");
  const locale = localeOf(payload);
  const ctx = await toolCtx(request, { issueKey: str(payload, "issueKey"), repoSlug });
  const neighbors = await whoTouches(ctx, { repoSlug, path });
  return {
    tool: "who-touches",
    text: neighborsText(neighbors, locale, ctx.now()),
    neighbors,
    count: neighbors.length,
  };
}

export async function getWorksiteTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const issueKey = required(payload, "issueKey");
  const locale = localeOf(payload);
  const ctx = await toolCtx(request, { issueKey });
  const panel = await getWorksitePanel(ctx, issueKey);
  return { tool: "get-worksite", text: panelText(panel, locale, ctx.now()), panel };
}

/**
 * "predict-footprint". The daily job keeps a stored prediction fresh; on a
 * cache miss it is computed here from the ticket and the merged history of the
 * project's repository (see glue/prediction — one implementation, three
 * callers). Prediction is never blocking (spec §5).
 */
export async function predictFootprintTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const issueKey = required(payload, "issueKey");
  const locale = localeOf(payload);
  const ctx = await toolCtx(request, { issueKey });
  const lookup = await predictionFor(ctx, issueKey);
  return {
    tool: "predict-footprint",
    text: predictionText(lookup.prediction, locale),
    prediction: lookup.prediction,
    cached: lookup.cached,
  };
}

/** Collision rows with both sides named (the store only keeps worksite ids). */
async function enrichCollisions(
  ctx: Ctx,
  collisions: Collision[],
  locale: Locale,
): Promise<CollisionRow[]> {
  const rows: CollisionRow[] = [];
  for (const collision of collisions.slice(0, MAX_COLLISION_ROWS)) {
    const row: CollisionRow = {
      collisionId: collision.id,
      degree: collision.degree,
      phase: collision.phase,
      state: collision.state,
      path: collision.path,
      probable: collision.probable,
      resolution: collision.resolution,
    };
    const a = await ctx.stores.worksites.findById(collision.worksiteA);
    const b = await ctx.stores.worksites.findById(collision.worksiteB);
    if (a !== undefined) row.a = await buildNeighborInfo(ctx, a, locale);
    if (b !== undefined) row.b = await buildNeighborInfo(ctx, b, locale);
    rows.push(row);
  }
  return rows;
}

export async function listCollisionsTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const jql = required(payload, "jql");
  const locale = localeOf(payload);
  const ctx = await toolCtx(request);
  const collisions = await listCollisions(ctx, { jql });
  const rows = await enrichCollisions(ctx, collisions, locale);
  return {
    tool: "list-collisions",
    text: collisionsText(rows, locale),
    collisions: rows,
    count: collisions.length,
  };
}

export async function nextClearTicketTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const jql = required(payload, "jql");
  const session = str(payload, "session");
  const ctx = await toolCtx(request, { sessionRef: session });
  const next = await nextClearTicket(ctx, { jql, session });
  return {
    tool: "next-clear-ticket",
    text: next.issueKey === undefined ? next.why : `${next.issueKey}: ${next.why}`,
    issueKey: next.issueKey,
    alternatives: next.alternatives,
  };
}

export async function listClearWorkTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const jql = required(payload, "jql");
  const session = str(payload, "session");
  const ctx = await toolCtx(request, { sessionRef: session });
  const tickets = await listClearWork(ctx, { jql, session });
  return {
    tool: "list-clear-work",
    text: ticketsText(tickets, "ready to start, nobody collides"),
    tickets,
    count: tickets.length,
  };
}

export async function measureParallelWidthTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const jql = str(payload, "jql");
  const repoSlug = str(payload, "repo");
  const ctx = await toolCtx(request, { repoSlug: repoSlug || undefined });
  const report = await measureParallelWidth(ctx, {
    jql: jql || undefined,
    repoSlug: repoSlug || undefined,
  });
  const lines = [
    `parallel width: ${report.width} agent(s) at once over ${report.ticketCount} ticket(s) (confidence: ${report.confidence})`,
    ...report.bottlenecks.map(
      (b) => `bottleneck: ${b.label} — ${b.edges} collision link(s)`,
    ),
  ];
  if (report.suggestion) {
    lines.push(
      `${report.suggestion.split} → width ${report.suggestion.widthAfter} (+${report.suggestion.delta})`,
    );
  }
  if (report.note) lines.push(report.note);
  return { tool: "measure-parallel-width", text: lines.join("\n"), report };
}

export async function planParallelWorkTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const jql = required(payload, "jql");
  const workers = int(payload, "workers") ?? 1;
  const ctx = await toolCtx(request);
  const plan = await planParallelWork(ctx, { jql, workers: Math.max(1, workers) });
  return { tool: "plan-parallel-work", text: wavePlanText(plan), plan };
}

export async function reserveZoneTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const issueKey = required(payload, "issueKey");
  const repoSlug = required(payload, "repo");
  const locale = localeOf(payload);
  const ctx = await toolCtx(request, { issueKey, sessionRef: str(payload, "session") });
  const result = await reserveZone(ctx, {
    issueKey,
    repoSlug,
    paths: paths(payload),
    minutes: int(payload, "minutes"),
    reason: str(payload, "reason"),
  });
  const refused = "refused" in result;
  return {
    tool: "reserve-zone",
    text: reservationText(result, locale, ctx.now()),
    refused,
    reservation: refused ? undefined : result,
    reason: refused ? result.reason : undefined,
  };
}

export async function postNoticeTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const issueKey = required(payload, "issueKey");
  const text = required(payload, "text");
  const locale = localeOf(payload);
  const ctx = await toolCtx(request, { issueKey, sessionRef: str(payload, "session") });
  const result = await postNotice(ctx, {
    issueKey,
    paths: paths(payload),
    text,
    repoSlug: str(payload, "repo"),
  });
  return {
    tool: "post-notice",
    text: noticeText(result.notice, result.recipients, locale),
    notice: result.notice,
    recipients: result.recipients,
  };
}

export async function resolveCollisionTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const collisionId = required(payload, "collisionId");
  const choice = oneOf(payload, "choice", CHOICES);
  if (choice === undefined) {
    throw new ToolInputError(`choice must be one of: ${CHOICES.join(", ")}`);
  }
  const locale = localeOf(payload);
  const ctx = await toolCtx(request, { sessionRef: str(payload, "session") });
  const outcome = await resolveCollision(ctx, {
    collisionId,
    choice,
    reason: str(payload, "reason"),
  });
  return {
    tool: "resolve-collision",
    text: resolutionText(outcome, locale),
    outcome,
    recorded: outcome.recorded,
  };
}

export async function closeWorksiteTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const issueKey = required(payload, "issueKey");
  const session = str(payload, "session");
  const locale = localeOf(payload);
  const ctx = await toolCtx(request, { issueKey, sessionRef: session });
  const result = await closeWorksite(ctx, {
    issueKey,
    repoSlug: str(payload, "repo"),
    session,
    outcome: oneOf(payload, "outcome", [...OUTCOMES]) ?? "merged",
  });
  return {
    tool: "close-worksite",
    text: closeText(result.closed, result.released, locale, ctx.now()),
    closed: result.closed,
    released: result.released,
  };
}

export async function reportConflictTool(request: ToolRequest): Promise<ToolResult> {
  const payload = payloadOf(request);
  const issueKey = required(payload, "issueKey");
  const repoSlug = required(payload, "repo");
  const ctx = await toolCtx(request, { issueKey });
  const conflict = await reportConflict(ctx, {
    issueKey,
    repoSlug,
    paths: paths(payload),
    withIssueKey: str(payload, "withIssueKey"),
  });
  return {
    tool: "report-conflict",
    text: conflictText(conflict),
    conflict,
    wasDetected: conflict.wasDetected,
  };
}

/* ------------------------------------------------------------------ */
/* Registry: tool key (manifest) AND function key (manifest) → handler  */
/* ------------------------------------------------------------------ */

export const MCP_TOOLS: Record<string, ToolHandler> = {
  "declare-footprint": declareFootprintTool,
  declareFootprint: declareFootprintTool,
  "check-zone": checkZoneTool,
  checkZone: checkZoneTool,
  "who-touches": whoTouchesTool,
  whoTouches: whoTouchesTool,
  "get-worksite": getWorksiteTool,
  getWorksite: getWorksiteTool,
  "predict-footprint": predictFootprintTool,
  predictFootprintTool: predictFootprintTool,
  "list-collisions": listCollisionsTool,
  listCollisions: listCollisionsTool,
  "list-clear-work": listClearWorkTool,
  listClearWork: listClearWorkTool,
  "next-clear-ticket": nextClearTicketTool,
  nextClearTicket: nextClearTicketTool,
  "plan-parallel-work": planParallelWorkTool,
  planParallelWork: planParallelWorkTool,
  "measure-parallel-width": measureParallelWidthTool,
  measureParallelWidth: measureParallelWidthTool,
  "reserve-zone": reserveZoneTool,
  reserveZone: reserveZoneTool,
  "post-notice": postNoticeTool,
  postNotice: postNoticeTool,
  "resolve-collision": resolveCollisionTool,
  resolveCollision: resolveCollisionTool,
  "close-worksite": closeWorksiteTool,
  closeWorksiteTool: closeWorksiteTool,
  "report-conflict": reportConflictTool,
  reportConflict: reportConflictTool,
};

/** The 15 tool keys of manifest.yml (`modules.rovo:mcp[0].tools`). */
export const MCP_TOOL_KEYS = [
  "declare-footprint",
  "check-zone",
  "who-touches",
  "get-worksite",
  "predict-footprint",
  "list-collisions",
  "list-clear-work",
  "next-clear-ticket",
  "plan-parallel-work",
  "measure-parallel-width",
  "reserve-zone",
  "post-notice",
  "resolve-collision",
  "close-worksite",
  "report-conflict",
];
