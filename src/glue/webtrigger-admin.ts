/**
 * glue/webtrigger-admin — shared HTTP helpers + the operator routes of the
 * ingest web trigger: `/status` (read-only observability, token required)
 * and `/bootstrap` (one-shot token minting, armed by the BOOTSTRAP_SECRET
 * deployment variable, constant-time compare, dead by default).
 * webtrigger.ts imports from here (one-way); this file imports only TYPES
 * from webtrigger.ts, so there is no runtime cycle.
 */

import { timingSafeEqual } from "node:crypto";
import type { BuildCtxOptions } from "../forge-context";
import type { HookToken } from "../core/types";
import type {
  WebtriggerDeps,
  WebtriggerHttpResponse,
  WebtriggerRequest,
  WebtriggerRoute,
} from "./webtrigger";

export const JSON_HEADERS = { "Content-Type": ["application/json"] };

/* ------------------------------------------------------------------ */
/* Shared untyped-JSON helpers                                          */
/* ------------------------------------------------------------------ */

export function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** First header value, case-insensitively (Forge lower-cases, proxies may not). */
export function header(headers: WebtriggerRequest["headers"], name: string): string | undefined {
  if (headers === undefined) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? text(value[0]) : text(value);
  }
  return undefined;
}

export function parseBody(body?: string): Record<string, unknown> {
  if (body === undefined || body.trim() === "") return {};
  try {
    return rec(JSON.parse(body));
  } catch {
    return {}; // a malformed body is just an empty one: fail open
  }
}

export function jsonResponse(payload: unknown, statusCode = 200): WebtriggerHttpResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

/* ------------------------------------------------------------------ */
/* Operator routes                                                      */
/* ------------------------------------------------------------------ */

/** Constant-time string comparison (bootstrap secret). */
function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** GET-ish observability: what the installation currently holds. */
export async function onStatus(
  token: HookToken,
  deps: WebtriggerDeps,
): Promise<WebtriggerHttpResponse> {
  const ctx = await deps.buildCtx(ctxOptions("status", token));
  return jsonResponse(await deps.status(ctx));
}

/**
 * One-shot token minting, armed by the BOOTSTRAP_SECRET deployment variable
 * (set → deploy → mint → REMOVE the variable → deploy). Without the variable
 * the route does not exist. The secret is compared in constant time.
 */
export async function onBootstrap(
  request: WebtriggerRequest,
  deps: WebtriggerDeps,
): Promise<WebtriggerHttpResponse> {
  const secret = process.env.BOOTSTRAP_SECRET;
  if (secret === undefined || secret === "") return emptyResponse();
  const provided = header(request.headers, "x-bootstrap-secret");
  if (provided === undefined || !secretEquals(provided, secret)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  const body = parseBody(request.body);
  const account =
    text(body.account) ?? process.env.BOOTSTRAP_ACCOUNT ?? "bootstrap@chantiers.local";
  const scope = text(body.scope) === "project" ? "project" : "personal";
  const options: BuildCtxOptions = {
    context: { accountId: account },
    client: "bootstrap",
  };
  const project = text(body.project);
  if (project !== undefined) options.projectId = project.toUpperCase();
  const ctx = await deps.buildCtx(options);
  const repoSlug = text(body.repoSlug) ?? text(body.repo);
  try {
    if (repoSlug !== undefined) await deps.ensureRepo(ctx, normalizeSlugSafe(repoSlug));
    const created = await deps.createToken(ctx, scope);
    return jsonResponse({
      token: created.token,
      scope: created.scope,
      shownOnce: true,
      repoSlug,
      account,
    });
  } catch (e) {
    // Bootstrap is an operator route, not an agent hook: say what broke.
    console.error("bootstrap failed", e);
    return jsonResponse({ error: `bootstrap failed: ${(e as Error).message}` }, 500);
  }
}

function normalizeSlugSafe(slug: string): string {
  return slug.trim().replace(/^\/+|\/+$/g, "");
}

export function ctxOptions(
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

/** 200 with an empty body: the agent continues, nothing is injected. */
export function emptyResponse(): WebtriggerHttpResponse {
  return { statusCode: 200, body: "" };
}
