/**
 * glue/tool-helpers — shared payload parsing, identity rules and Ctx
 * building for the MCP tools (split out of resolvers-mcp.ts for the
 * <500-lines rule). Identity comes from the Forge context or the token,
 * NEVER from an input (spec §9.6); `session` only distinguishes sessions.
 */

import type { FootprintMode, Locale, ResolutionChoice } from "../core/types";
import type { Ctx } from "../services/ctx";
import { buildCtx, type BuildCtxOptions, type ForgeInvocationContext } from "../forge-context";
import { projectOfRepoSlug } from "./discovery";

/** Payload of an action / resolver call: simple values only. */
export type ToolPayload = Record<string, unknown>;

export interface ToolRequest {
  payload?: ToolPayload;
  context?: ForgeInvocationContext;
}

/** Everything a tool returns must be JSON-serializable (the resolver checks). */
export interface ToolResult {
  tool: string;
  text: string;
  [key: string]: unknown;
}

export type ToolHandler = (request: ToolRequest) => Promise<ToolResult>;

/**
 * Test seam: the Ctx factory the tools go through. Production uses
 * `buildCtx` (Forge SQL stores, real clock, Jira port); tests replace it with
 * the same `buildCtx` on memory stores + a controllable clock, so the parsing,
 * the identity rules and the service wiring are exercised for real.
 */
export interface McpDeps {
  buildCtx(options: BuildCtxOptions): Promise<Ctx>;
}

export const MCP_DEPS: McpDeps = { buildCtx };

/** A required input is missing or of the wrong shape. */
export class ToolInputError extends Error {}

export const MODES: FootprintMode[] = ["edit", "create", "delete", "rename"];
export const OUTCOMES = ["merged", "abandoned", "done"] as const;
export const CHOICES: ResolutionChoice[] = [
  "wait",
  "sequence",
  "coordinate",
  "split",
  "merge",
  "override",
];
/** Cap on the enriched collision list (an action may not return 5 MB). */
export const MAX_COLLISION_ROWS = 40;

/* ------------------------------------------------------------------ */
/* Payload parsing (no duplication between the 13 tools)                */
/* ------------------------------------------------------------------ */

export function payloadOf(request: ToolRequest): ToolPayload {
  return request.payload ?? {};
}

export function str(payload: ToolPayload, name: string): string | undefined {
  const value = payload[name];
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function required(payload: ToolPayload, name: string): string {
  const value = str(payload, name);
  if (value === undefined) throw new ToolInputError(`missing required input: ${name}`);
  return value;
}

export function int(payload: ToolPayload, name: string): number | undefined {
  const value = payload[name];
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

/** `paths` arrives as ONE string, one path per line (spec §15). */
export function paths(payload: ToolPayload, name = "paths"): string {
  return str(payload, name) ?? "";
}

export function oneOf<T extends string>(payload: ToolPayload, name: string, allowed: T[]): T | undefined {
  const value = str(payload, name)?.toLowerCase();
  return value !== undefined && allowed.includes(value as T) ? (value as T) : undefined;
}

/** Submission language is English; a caller may still ask for French. */
export function localeOf(payload: ToolPayload): Locale {
  return oneOf(payload, "locale", ["en", "fr"] as Locale[]) ?? "en";
}

export async function toolCtx(
  request: ToolRequest,
  extra: { issueKey?: string; sessionRef?: string; agentRef?: string; repoSlug?: string } = {},
): Promise<Ctx> {
  const options: BuildCtxOptions = {
    context: request.context,
    client: "mcp",
    issueKey: extra.issueKey,
    sessionRef: extra.sessionRef,
    agentRef: extra.agentRef,
  };
  const ctx = await MCP_DEPS.buildCtx(options);
  // A repo-only call (check-zone, who-touches) carries no project: without a
  // hint the repos/zones/rules bucket would be the installation default and
  // the repository would not be found. Look for the project that owns the slug.
  if (extra.repoSlug === undefined || extra.issueKey !== undefined) return ctx;
  if (projectHinted(request.context)) return ctx;
  const projectId = await projectOfRepoSlug(ctx, extra.repoSlug);
  if (projectId === undefined || projectId === ctx.projectId) return ctx;
  return MCP_DEPS.buildCtx({ ...options, projectId });
}

/** True when the platform told us which Jira project the call comes from. */
function projectHinted(context?: ForgeInvocationContext): boolean {
  const key = context?.projectKey ?? context?.jira?.projectKey;
  return typeof key === "string" && key !== "";
}
