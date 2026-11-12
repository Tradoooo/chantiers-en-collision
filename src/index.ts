/**
 * Entry point — every handler referenced by manifest.yml (`index.<name>`).
 * Owner: workstream I (glue). The 20 function modules:
 *   main                              → the UI (glue/ui-resolvers, UI kit render)
 *   declareFootprint … reportConflict → the 13 MCP tools (glue/resolvers-mcp)
 *   handleIngest                      → the web trigger (glue/webtrigger)
 *   issueEvents                       → the Jira trigger (glue/triggers)
 *   sweepFiveMinute, dailyJobs        → the scheduled triggers (glue/triggers)
 *   jqlCollidingWork, jqlCollidesWith → the JQL functions (glue/triggers)
 *
 * This file only wires: parsing, identity and business rules live in
 * src/glue/** and src/services/**.
 *
 * A `Resolver` (@forge/resolver) ALSO exposes every tool and every screen's
 * data under a stable key, so a call arriving through the resolver envelope
 * (`{ call: { functionKey, payload }, context }`) is served by the same
 * implementations. NOTE: @forge/resolver 2.0 has no `toHandler()` — the
 * equivalent export is `getDefinitions()` (node_modules/@forge/resolver/out/
 * index.d.ts); `handler` below is that value.
 */

import Resolver from "@forge/resolver";
import type { ForgeInvocationContext } from "./forge-context";
import {
  MCP_TOOLS,
  MCP_TOOL_KEYS,
  type ToolRequest,
  type ToolResult,
} from "./glue/resolvers-mcp";
import {
  dailyJobs as dailyJobsTrigger,
  issueEvents as issueEventsTrigger,
  jqlCollidesWith as jqlCollidesWithTrigger,
  jqlCollidingWork as jqlCollidingWorkTrigger,
  sweepFiveMinute as sweepTrigger,
  type JqlResult,
} from "./glue/triggers";
import {
  UI_DATA_KEYS,
  detectModule,
  main as uiMain,
  uiData,
  type UiModule,
} from "./glue/ui-resolvers";
import {
  handleIngest as ingestWebtrigger,
  type WebtriggerHttpResponse,
  type WebtriggerRequest,
} from "./glue/webtrigger";
import type { SweepResult } from "./services/maintenance";

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** manifest.yml `function.key` of each MCP tool (two of them are suffixed). */
const TOOL_FUNCTION_KEYS: Record<string, string> = {
  "declare-footprint": "declareFootprint",
  "check-zone": "checkZone",
  "who-touches": "whoTouches",
  "get-worksite": "getWorksite",
  "predict-footprint": "predictFootprintTool",
  "list-collisions": "listCollisions",
  "list-clear-work": "listClearWork",
  "next-clear-ticket": "nextClearTicketTool",
  "plan-parallel-work": "planParallelWork",
  "measure-parallel-width": "measureParallelWidth",
  "reserve-zone": "reserveZone",
  "post-notice": "postNotice",
  "resolve-collision": "resolveCollision",
  "close-worksite": "closeWorksiteTool",
  "report-conflict": "reportConflict",
  "create-hook-token": "createHookToken",
};

function camelCase(key: string): string {
  return key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * Forge calls a function module as `handler(payload, context)`. Three shapes
 * are accepted, because the platform differs per entry point:
 *  - action / MCP tool: `payload` = the declared inputs, and Rovo may nest the
 *    product context under `payload.context` (rovo-action reference);
 *  - resolver envelope: `payload` = `{ call: { functionKey, payload }, context }`;
 *  - plain call: `payload` = the inputs, `context` = the Forge context.
 * The ACCOUNT always comes from the Forge context, never from the inputs
 * (spec §9.6): the product context only adds issueKey/projectKey.
 */
export function requestOf(payload: unknown, context?: unknown): ToolRequest {
  const envelope = rec(payload);
  const call = rec(envelope.call);
  const inputs = envelope.call === undefined ? envelope : rec(call.payload);
  const productContext = rec(inputs.context);
  const toolPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (key !== "context" && key !== "call") toolPayload[key] = value;
  }
  const merged: ForgeInvocationContext = {
    ...productContext,
    ...rec(envelope.context),
    ...rec(context),
  };
  return { payload: toolPayload, context: merged };
}

/** One exported handler per MCP tool, bound to its registry entry. */
function toolHandler(toolKey: string) {
  const handler = MCP_TOOLS[toolKey];
  return async (payload?: unknown, context?: unknown): Promise<ToolResult> =>
    handler(requestOf(payload, context));
}

/* ------------------------------------------------------------------ */
/* manifest function modules                                            */
/* ------------------------------------------------------------------ */

/** Every UI module points here: the screen is chosen from the product context. */
export const main = uiMain;

export const declareFootprint = toolHandler("declare-footprint");
export const checkZone = toolHandler("check-zone");
export const whoTouches = toolHandler("who-touches");
export const getWorksite = toolHandler("get-worksite");
export const predictFootprintTool = toolHandler("predict-footprint");
export const listCollisions = toolHandler("list-collisions");
export const listClearWork = toolHandler("list-clear-work");
export const nextClearTicketTool = toolHandler("next-clear-ticket");
export const planParallelWork = toolHandler("plan-parallel-work");
export const measureParallelWidth = toolHandler("measure-parallel-width");
export const createHookToken = toolHandler("create-hook-token");
export const reserveZone = toolHandler("reserve-zone");
export const postNotice = toolHandler("post-notice");
export const resolveCollision = toolHandler("resolve-collision");
export const closeWorksiteTool = toolHandler("close-worksite");
export const reportConflict = toolHandler("report-conflict");

/** Web trigger `ingest`: hook (open/touch/close) + CI (footprint/conflict). */
export async function handleIngest(
  request: WebtriggerRequest,
): Promise<WebtriggerHttpResponse> {
  return ingestWebtrigger(request);
}

/** Trigger `issue-events`: created → planned worksite; in progress → open; done → close. */
export async function issueEvents(event?: unknown, context?: unknown): Promise<void> {
  await issueEventsTrigger(event, context as ForgeInvocationContext | undefined);
}

/** scheduledTrigger `five-minute-sweep`: dormancy, auto-close, expirations. */
export async function sweepFiveMinute(event?: unknown, context?: unknown): Promise<SweepResult[]> {
  return sweepTrigger(event, context as ForgeInvocationContext | undefined);
}

/** scheduledTrigger `daily-jobs`: predictions + prediction accuracy. */
export async function dailyJobs(
  event?: unknown,
  context?: unknown,
): Promise<{ predictions: number; accuracyComputed: number }[]> {
  return dailyJobsTrigger(event, context as ForgeInvocationContext | undefined);
}

/** jira:jqlFunction `collidingWork()` → a JQL predicate over colliding tickets. */
export async function jqlCollidingWork(args?: unknown, context?: unknown): Promise<JqlResult> {
  return jqlCollidingWorkTrigger(args, context as ForgeInvocationContext | undefined);
}

/** jira:jqlFunction `collidesWith("PROJ-88")` → its open collision partners. */
export async function jqlCollidesWith(args?: unknown, context?: unknown): Promise<JqlResult> {
  return jqlCollidesWithTrigger(args, context as ForgeInvocationContext | undefined);
}

/* ------------------------------------------------------------------ */
/* Resolver: same implementations, reachable by key                     */
/* ------------------------------------------------------------------ */

const resolver = new Resolver();

resolver.define("main", ({ payload, context }) =>
  uiData(detectModule(context, payload), context, rec(payload)),
);

for (const [module, key] of Object.entries(UI_DATA_KEYS)) {
  resolver.define(key, ({ payload, context }) => uiData(module as UiModule, context, rec(payload)));
}

const defined = new Set<string>(["main", ...Object.values(UI_DATA_KEYS)]);
for (const toolKey of MCP_TOOL_KEYS) {
  for (const key of [toolKey, camelCase(toolKey), TOOL_FUNCTION_KEYS[toolKey]]) {
    if (key === undefined || defined.has(key)) continue;
    defined.add(key);
    resolver.define(key, ({ payload, context }) =>
      MCP_TOOLS[toolKey]({ payload: rec(payload), context }),
    );
  }
}

/** Resolver handler (`getDefinitions()` is @forge/resolver 2.0's `toHandler`). */
export const handler = resolver.getDefinitions();
