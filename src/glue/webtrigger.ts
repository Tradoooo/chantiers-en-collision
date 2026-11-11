/**
 * glue/webtrigger — the `ingest` web trigger: agent-client hook + CI (spec §9.3,
 * §10, §17). Owner: workstream I (glue).
 *
 * THREE properties, by design:
 *  1. PURE + INJECTABLE — `routeWebtrigger(request, deps?)` takes every service
 *     as a parameter (defaults to the real ones), so the routing, the
 *     sanitization and the fail-open behaviour are unit-testable with spies and
 *     without Forge.
 *  2. SANITIZED (§17) — from a raw hook event the endpoint keeps ONLY
 *     `tool_input.file_path`, `session_id`, `cwd`, `agent_id`, `agent_type` and
 *     `hook_event_name`. Everything else (`tool_input.old_string`,
 *     `new_string`, any file content) is dropped BEFORE any processing, any
 *     service call and any storage. The app stores paths, never content (§20).
 *  3. FAIL-OPEN (§20) — any error, any unknown route, any missing token answers
 *     HTTP 200 with an empty body: the agent keeps working. The product advises;
 *     it only refuses where the project decided to (hard mode).
 *
 * Identity (§9.6): the account comes from the VERIFIED Bearer token, never from
 * the body. A personal token identifies its pilot; a project token may only
 * post attested footprints and real conflicts (`/ci/*`) — it cannot open,
 * touch or close a session.
 *
 * Route discovery: with `urlFormat: v2` the request path ends with the route
 * (`…/v2/<appId>/ingest/touch`), so routes are matched by suffix.
 */

import type {
  CiFootprintInput,
  HookOpenEvent,
  HookResponse,
  HookToken,
  HookTouchEvent,
  RealConflict,
  Worksite,
} from "../core/types";
import type { Ctx } from "../services/ctx";
import type { BuildCtxOptions } from "../forge-context";
import { buildCtx } from "../forge-context";
import {
  ciFootprint as ciFootprintService,
  hookClose as hookCloseService,
  hookOpen as hookOpenService,
  hookTouch as hookTouchService,
  reportConflict as reportConflictService,
} from "../services/ingest";
import { verifyToken as verifyTokenService } from "../services/tokens";

export type WebtriggerRoute = "open" | "touch" | "close" | "ci-footprint" | "ci-conflict";

/** What Forge hands to a `urlFormat: v2` + `response: {type: dynamic}` trigger. */
export interface WebtriggerRequest {
  method?: string;
  /** Full request path; the route is its suffix (`/open`, `/ci/footprint`…). */
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: string;
  queryParameters?: Record<string, string | string[] | undefined>;
}

export interface WebtriggerHttpResponse {
  statusCode: number;
  headers?: Record<string, string[]>;
  body?: string;
}

/** Every collaborator of the router, injectable (tests pass spies). */
export interface WebtriggerDeps {
  buildCtx(options: BuildCtxOptions): Promise<Ctx>;
  verifyToken(ctx: Ctx, token: string): Promise<HookToken | undefined>;
  hookOpen(ctx: Ctx, event: HookOpenEvent): Promise<{ worksite?: Worksite; response: HookResponse }>;
  hookTouch(ctx: Ctx, event: HookTouchEvent): Promise<HookResponse>;
  hookClose(ctx: Ctx, event: { sessionRef: string; reason?: string }): Promise<void>;
  ciFootprint(ctx: Ctx, input: CiFootprintInput): Promise<{ worksite?: Worksite; entries: number }>;
  reportConflict(
    ctx: Ctx,
    input: { issueKey: string; repoSlug: string; paths: string; withIssueKey?: string },
  ): Promise<RealConflict>;
}

/** The real collaborators (used when no deps are injected). */
export const LIVE_DEPS: WebtriggerDeps = {
  buildCtx,
  verifyToken: verifyTokenService,
  hookOpen: hookOpenService,
  hookTouch: hookTouchService,
  hookClose: hookCloseService,
  ciFootprint: ciFootprintService,
  reportConflict: reportConflictService,
};

const JSON_HEADERS = { "Content-Type": ["application/json"] };
const ROUTE_SUFFIXES: [string, WebtriggerRoute][] = [
  ["/ci/footprint", "ci-footprint"],
  ["/ci/conflict", "ci-conflict"],
  ["/open", "open"],
  ["/touch", "touch"],
  ["/close", "close"],
];
/** Hook event names answered back to the client (§9.3). */
const HOOK_EVENT_NAMES: Record<"open" | "touch" | "close", string> = {
  open: "SessionStart",
  touch: "PreToolUse",
  close: "SessionEnd",
};

/* ------------------------------------------------------------------ */
/* Small untyped-JSON helpers                                           */
/* ------------------------------------------------------------------ */

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const parsed = text(value)?.toLowerCase();
  if (parsed === "true") return true;
  return parsed === "false" ? false : undefined;
}

function lines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => text(entry)).filter((entry): entry is string => entry !== undefined);
  }
  const raw = text(value);
  return raw === undefined ? [] : raw.split("\n");
}

function parseBody(body?: string): Record<string, unknown> {
  if (body === undefined || body.trim() === "") return {};
  try {
    return rec(JSON.parse(body));
  } catch {
    return {}; // a malformed body is just an empty one: fail open
  }
}

/* ------------------------------------------------------------------ */
/* Routing, auth                                                        */
/* ------------------------------------------------------------------ */

/** Route of a v2 web trigger path, matched by suffix (`/ingest/touch`). */
export function routeOf(path?: string): WebtriggerRoute | undefined {
  if (path === undefined) return undefined;
  const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const normalized = clean.startsWith("/") ? clean.toLowerCase() : `/${clean.toLowerCase()}`;
  for (const [suffix, route] of ROUTE_SUFFIXES) {
    if (normalized.endsWith(suffix)) return route;
  }
  return undefined;
}

/** First header value, case-insensitively (Forge lower-cases, proxies may not). */
function header(headers: WebtriggerRequest["headers"], name: string): string | undefined {
  if (headers === undefined) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? text(value[0]) : text(value);
  }
  return undefined;
}

/** `Authorization: Bearer <token>` → the token, else undefined. */
export function bearerOf(headers: WebtriggerRequest["headers"]): string | undefined {
  const value = header(headers, "authorization");
  if (value === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match === null ? undefined : match[1].trim();
}

/** A project token may only send attested footprints and real conflicts. */
export function tokenAllows(route: WebtriggerRoute, token: HookToken): boolean {
  if (token.scope !== "project") return true;
  return route === "ci-footprint" || route === "ci-conflict";
}

/* ------------------------------------------------------------------ */
/* SANITIZATION (§17) — nothing but path/session/cwd/agent leaves here   */
/* ------------------------------------------------------------------ */

/** Raw PreToolUse event → the only fields the app is allowed to look at. */
export function sanitizeTouch(body: unknown): { event: HookTouchEvent; hookEventName: string } | undefined {
  const raw = rec(body);
  const toolInput = rec(raw.tool_input);
  const path = text(toolInput.file_path);
  const sessionRef = text(raw.session_id);
  if (path === undefined || sessionRef === undefined) return undefined;
  const event: HookTouchEvent = { sessionRef, path };
  const cwd = text(raw.cwd);
  const agentRef = text(raw.agent_id);
  const agentType = text(raw.agent_type);
  if (cwd !== undefined) event.cwd = cwd;
  if (agentRef !== undefined) event.agentRef = agentRef;
  if (agentType !== undefined) event.agentType = agentType;
  return { event, hookEventName: text(raw.hook_event_name) ?? HOOK_EVENT_NAMES.touch };
}

/** Raw SessionStart body → branch + session (+ cwd/agent). `client` and
 *  `issueKey` sent by the script are DROPPED: the client comes from the token
 *  and the ticket key is read from the branch by the service (§9.6). */
export function sanitizeOpen(body: unknown): HookOpenEvent | undefined {
  const raw = rec(body);
  const sessionRef = text(raw.sessionRef) ?? text(raw.session_id);
  const branch = text(raw.branch);
  if (sessionRef === undefined || branch === undefined) return undefined;
  const event: HookOpenEvent = { sessionRef, branch };
  const cwd = text(raw.cwd);
  const agentRef = text(raw.agent_id) ?? text(raw.agentRef);
  if (cwd !== undefined) event.cwd = cwd;
  if (agentRef !== undefined) event.agentRef = agentRef;
  return event;
}

/** Raw SessionEnd body → session + reason, nothing else. */
export function sanitizeClose(body: unknown): { sessionRef: string; reason?: string } | undefined {
  const raw = rec(body);
  const sessionRef = text(raw.sessionRef) ?? text(raw.session_id);
  if (sessionRef === undefined) return undefined;
  const out: { sessionRef: string; reason?: string } = { sessionRef };
  const reason = text(raw.reason);
  if (reason !== undefined) out.reason = reason;
  return out;
}

/** CI body → the attested footprint input (`files` or one-path-per-line `paths`). */
export function sanitizeCiFootprint(body: unknown): CiFootprintInput | undefined {
  const raw = rec(body);
  const repoSlug = text(raw.repoSlug) ?? text(raw.repo);
  const branch = text(raw.branch);
  const files = lines(raw.files ?? raw.paths).map((line) => line.trim()).filter((l) => l !== "");
  if (repoSlug === undefined || branch === undefined || files.length === 0) return undefined;
  const input: CiFootprintInput = { repoSlug, branch, files };
  const baseBranch = text(raw.baseBranch);
  const issueKey = text(raw.issueKey);
  const prOpen = bool(raw.prOpen);
  const prApproved = bool(raw.prApproved);
  if (baseBranch !== undefined) input.baseBranch = baseBranch;
  if (issueKey !== undefined) input.issueKey = issueKey;
  if (prOpen !== undefined) input.prOpen = prOpen;
  if (prApproved !== undefined) input.prApproved = prApproved;
  return input;
}

/** CI body → a real conflict report (`paths`: array or one per line). */
export function sanitizeCiConflict(
  body: unknown,
): { issueKey: string; repoSlug: string; paths: string; withIssueKey?: string } | undefined {
  const raw = rec(body);
  const issueKey = text(raw.issueKey);
  const repoSlug = text(raw.repoSlug) ?? text(raw.repo);
  const paths = lines(raw.paths).map((line) => line.trim()).filter((l) => l !== "").join("\n");
  if (issueKey === undefined || repoSlug === undefined || paths === "") return undefined;
  const out = { issueKey, repoSlug, paths };
  const withIssueKey = text(raw.withIssueKey);
  return withIssueKey === undefined ? out : { ...out, withIssueKey };
}

/* ------------------------------------------------------------------ */
/* Responses                                                            */
/* ------------------------------------------------------------------ */

/** 200 with an empty body: the agent continues, nothing is injected. */
export function emptyResponse(): WebtriggerHttpResponse {
  return { statusCode: 200, body: "" };
}

function jsonResponse(payload: unknown, statusCode = 200): WebtriggerHttpResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

/** The hook JSON of spec §9.3: additionalContext, or a hard-mode deny. */
export function hookJson(hookEventName: string, response: HookResponse): WebtriggerHttpResponse {
  if (response.deny !== undefined) {
    return jsonResponse({
      hookSpecificOutput: {
        hookEventName,
        permissionDecision: "deny",
        permissionDecisionReason: response.deny.reason,
      },
    });
  }
  if (response.additionalContext === undefined || response.additionalContext === "") {
    return emptyResponse();
  }
  return jsonResponse({ hookSpecificOutput: { hookEventName, additionalContext: response.additionalContext } });
}

/* ------------------------------------------------------------------ */
/* The router                                                           */
/* ------------------------------------------------------------------ */

function ctxOptions(
  route: WebtriggerRoute,
  token: HookToken,
  sessionRef?: string,
  agentRef?: string,
  issueKey?: string,
): BuildCtxOptions {
  const options: BuildCtxOptions = {
    token,
    client: route.startsWith("ci") ? "ci" : "hook",
    sessionRef,
    agentRef,
    issueKey,
  };
  if (token.projectId !== undefined) options.projectId = token.projectId;
  return options;
}

/**
 * Route one web trigger request. PURE: every side effect goes through `deps`.
 * Never throws — anything unexpected becomes HTTP 200 with an empty body.
 */
export async function routeWebtrigger(
  request: WebtriggerRequest,
  deps: WebtriggerDeps = LIVE_DEPS,
): Promise<WebtriggerHttpResponse> {
  try {
    const route = routeOf(request.path);
    if (route === undefined) return emptyResponse();
    const token = bearerOf(request.headers);
    if (token === undefined) return emptyResponse();
    const baseCtx = await deps.buildCtx({});
    const verified = await deps.verifyToken(baseCtx, token);
    // Unknown token on a hook route: stay silent (fail open). On a CI route the
    // caller is a pipeline, not an agent: say 401 so the step is fixed.
    if (verified === undefined) return route.startsWith("ci") ? jsonResponse({ error: "unauthorized" }, 401) : emptyResponse();
    if (!tokenAllows(route, verified)) return emptyResponse();
    const body = parseBody(request.body);
    return await dispatch(route, body, verified, deps, request);
  } catch {
    return emptyResponse(); // FAIL-OPEN, always
  }
}

async function dispatch(
  route: WebtriggerRoute,
  body: Record<string, unknown>,
  token: HookToken,
  deps: WebtriggerDeps,
  request: WebtriggerRequest,
): Promise<WebtriggerHttpResponse> {
  void request;
  if (route === "touch") return await onTouch(body, token, deps);
  if (route === "open") return await onOpen(body, token, deps);
  if (route === "close") return await onClose(body, token, deps);
  if (route === "ci-footprint") return await onCiFootprint(body, token, deps);
  return await onCiConflict(body, token, deps);
}

async function onTouch(
  body: Record<string, unknown>,
  token: HookToken,
  deps: WebtriggerDeps,
): Promise<WebtriggerHttpResponse> {
  const sanitized = sanitizeTouch(body);
  if (sanitized === undefined) return emptyResponse();
  const ctx = await deps.buildCtx(
    ctxOptions("touch", token, sanitized.event.sessionRef, sanitized.event.agentRef),
  );
  return hookJson(sanitized.hookEventName, await deps.hookTouch(ctx, sanitized.event));
}

async function onOpen(
  body: Record<string, unknown>,
  token: HookToken,
  deps: WebtriggerDeps,
): Promise<WebtriggerHttpResponse> {
  const event = sanitizeOpen(body);
  if (event === undefined) return emptyResponse();
  const issueKey = text(rec(body).issueKey);
  const ctx = await deps.buildCtx(ctxOptions("open", token, event.sessionRef, event.agentRef, issueKey));
  const result = await deps.hookOpen(ctx, event);
  return hookJson(HOOK_EVENT_NAMES.open, result.response);
}

async function onClose(
  body: Record<string, unknown>,
  token: HookToken,
  deps: WebtriggerDeps,
): Promise<WebtriggerHttpResponse> {
  const event = sanitizeClose(body);
  if (event === undefined) return emptyResponse();
  const ctx = await deps.buildCtx(ctxOptions("close", token, event.sessionRef));
  await deps.hookClose(ctx, event);
  return emptyResponse(); // SessionEnd output is not used (1.5 s budget)
}

async function onCiFootprint(
  body: Record<string, unknown>,
  token: HookToken,
  deps: WebtriggerDeps,
): Promise<WebtriggerHttpResponse> {
  const input = sanitizeCiFootprint(body);
  if (input === undefined) return jsonResponse({ error: "repoSlug, branch and files are required" }, 400);
  const ctx = await deps.buildCtx(ctxOptions("ci-footprint", token, undefined, undefined, input.issueKey));
  const result = await deps.ciFootprint(ctx, input);
  return jsonResponse({
    ok: true,
    entries: result.entries,
    worksiteId: result.worksite?.id,
    issueKey: result.worksite?.issueKey ?? input.issueKey,
  });
}

async function onCiConflict(
  body: Record<string, unknown>,
  token: HookToken,
  deps: WebtriggerDeps,
): Promise<WebtriggerHttpResponse> {
  const input = sanitizeCiConflict(body);
  if (input === undefined) return jsonResponse({ error: "issueKey, repoSlug and paths are required" }, 400);
  const ctx = await deps.buildCtx(ctxOptions("ci-conflict", token, undefined, undefined, input.issueKey));
  const conflict = await deps.reportConflict(ctx, input);
  return jsonResponse({ ok: true, conflictId: conflict.id, wasDetected: conflict.wasDetected });
}

/** The Forge handler of the `ingest` web trigger (manifest function key). */
export async function handleIngest(request: WebtriggerRequest): Promise<WebtriggerHttpResponse> {
  return routeWebtrigger(request, LIVE_DEPS);
}
