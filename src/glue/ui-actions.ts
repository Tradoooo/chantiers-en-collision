/**
 * glue/ui-actions — routes the action messages published by the screens of
 * workstreams J and K to the right service, and hands fresh data back.
 * Owner: workstream I (glue).
 *
 * The screens are presentational: they cannot import `@forge/*`
 * (docs/CONTRACTS.md rule 4), so every gesture is published as
 * `{ key, payload }` (see `useActionRequest` in src/ui/issuePanel.tsx and
 * `useActionBridge` in src/ui/projectSettings.tsx) and routed HERE.
 *
 * Keys handled (the union of what the screens declare):
 *   collisions.resolve    { collisionId, choice, reason? }   → services/resolve
 *   worksites.iWorkOnIt   { issueKey, repoId, zoneIds }      → declared footprint
 *   simulation.run        { scenarioKey }                    → simulation/run
 *   settings.saveZone     { name, nature, patterns, frozen* } → zones.upsert
 *   settings.saveRules    { order, agentYields, hardMode, dormancyHours }
 *   tokens.generate       {}                                  → services/tokens
 *   tokens.revoke         { tokenHash }                       → tokens.revoke
 *
 * DECISION (documented): `settings.saveZone` carries no repository, so the zone
 * is attached to the project's first repository unless the payload names one.
 * Its id is deterministic (`zone-<repoId>-<name>`), which makes "add zone"
 * idempotent — the store upserts instead of duplicating.
 */

import type {
  PriorityCriterion,
  PriorityRules,
  SimulationResult,
  Zone,
  ZoneNature,
} from "../core/types";
import { DEFAULT_PRIORITY_RULES } from "../core/types";
import type { Ctx } from "../services/ctx";
import { declareFootprint } from "../services/declare";
import { resolveCollision } from "../services/resolve";
import { createToken } from "../services/tokens";
import { runScenario } from "../simulation/run";
import { SCENARIOS } from "../simulation/scenarios";
import { buildCtx, type BuildCtxOptions } from "../forge-context";

export const UI_ACTION_KEYS = [
  "collisions.resolve",
  "worksites.iWorkOnIt",
  "simulation.run",
  "settings.saveZone",
  "settings.saveRules",
  "tokens.generate",
  "tokens.revoke",
] as const;

export interface UiActionRequest {
  key: string;
  payload?: Record<string, unknown>;
}

export interface UiActionResult {
  key: string;
  ok: boolean;
  /** One short line for the screen (a form message, an error…). */
  detail: string;
  data?: unknown;
}

export interface UiActionDeps {
  buildCtx(options: BuildCtxOptions): Promise<Ctx>;
  resolveCollision: typeof resolveCollision;
  declareFootprint: typeof declareFootprint;
  createToken: typeof createToken;
  runScenario: typeof runScenario;
  scenarios: typeof SCENARIOS;
}

export const LIVE_UI_ACTION_DEPS: UiActionDeps = {
  buildCtx,
  resolveCollision,
  declareFootprint,
  createToken,
  runScenario,
  scenarios: SCENARIOS,
};

const NATURES: ZoneNature[] = ["ordinary", "exclusive", "hotspot", "frozen", "out-of-scope"];
const CRITERIA: PriorityCriterion[] = [
  "reservation",
  "incident",
  "priority",
  "due",
  "advance",
  "first",
];

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function splitList(value: unknown): string[] {
  const raw = text(value);
  if (raw === undefined) return [];
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function ok(key: string, detail: string, data?: unknown): UiActionResult {
  return data === undefined ? { key, ok: true, detail } : { key, ok: true, detail, data };
}

function refused(key: string, detail: string): UiActionResult {
  return { key, ok: false, detail };
}

/* ------------------------------------------------------------------ */
/* One handler per action key                                           */
/* ------------------------------------------------------------------ */

async function onResolve(ctx: Ctx, payload: Record<string, unknown>, deps: UiActionDeps) {
  const collisionId = text(payload.collisionId);
  const choice = text(payload.choice) as PriorityCriterion | undefined;
  if (collisionId === undefined || choice === undefined) {
    return refused("collisions.resolve", "collisionId and choice are required");
  }
  const outcome = await deps.resolveCollision(ctx, {
    collisionId,
    choice: choice as never,
    reason: text(payload.reason),
  });
  return ok(
    "collisions.resolve",
    outcome.recorded ? `recorded: ${outcome.choice}` : "not recorded (unknown collision?)",
    outcome,
  );
}

/** "I'm working on it": the ticked zones become the declared footprint. */
async function onIWorkOnIt(ctx: Ctx, payload: Record<string, unknown>, deps: UiActionDeps) {
  const issueKey = text(payload.issueKey);
  const repoId = text(payload.repoId);
  if (issueKey === undefined || repoId === undefined) {
    return refused("worksites.iWorkOnIt", "issueKey and repoId are required");
  }
  const repo = await ctx.stores.repos.findById(repoId);
  if (repo === undefined) return refused("worksites.iWorkOnIt", `unknown repository ${repoId}`);
  const zoneIds = Array.isArray(payload.zoneIds) ? payload.zoneIds : [];
  const patterns: string[] = [];
  for (const zoneId of zoneIds) {
    const zone = await ctx.stores.zones.findById(String(zoneId));
    if (zone !== undefined) patterns.push(...zone.patterns);
  }
  if (patterns.length === 0) {
    return refused("worksites.iWorkOnIt", "tick at least one zone to declare");
  }
  const verdict = await deps.declareFootprint(ctx, {
    issueKey,
    repoSlug: repo.slug,
    paths: patterns.join("\n"),
    mode: "edit",
  });
  return ok("worksites.iWorkOnIt", `verdict: ${verdict.kind}`, verdict);
}

async function onSimulationRun(payload: Record<string, unknown>, deps: UiActionDeps) {
  const key = text(payload.scenarioKey);
  const scenario = deps.scenarios.find((entry) => entry.key === key) ?? deps.scenarios[0];
  if (scenario === undefined) return refused("simulation.run", "no scenario available");
  const result: SimulationResult = await deps.runScenario(scenario);
  return ok("simulation.run", result.allOk ? "all steps behaved as expected" : "some steps differ", result);
}

async function onSaveZone(ctx: Ctx, payload: Record<string, unknown>) {
  const name = text(payload.name);
  const nature = text(payload.nature) as ZoneNature | undefined;
  if (name === undefined || nature === undefined || !NATURES.includes(nature)) {
    return refused("settings.saveZone", "name and a known nature are required");
  }
  const repoId = text(payload.repoId) ?? (await ctx.stores.repos.listByProject(ctx.projectId))[0]?.id;
  if (repoId === undefined) return refused("settings.saveZone", "no repository registered");
  const zone: Zone = {
    id: `zone-${repoId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    repoId,
    name,
    patterns: splitList(payload.patterns),
    nature,
  };
  const frozenFrom = text(payload.frozenFrom);
  const frozenTo = text(payload.frozenTo);
  if (frozenFrom !== undefined) zone.frozenFrom = frozenFrom;
  if (frozenTo !== undefined) zone.frozenTo = frozenTo;
  if (text(payload.componentId) !== undefined) zone.componentId = text(payload.componentId);
  const saved = await ctx.stores.zones.upsert(zone);
  return ok("settings.saveZone", `zone "${saved.name}" saved (${saved.nature})`, saved);
}

async function onSaveRules(ctx: Ctx, payload: Record<string, unknown>) {
  const order = splitList(payload.order).filter((entry): entry is PriorityCriterion =>
    CRITERIA.includes(entry as PriorityCriterion),
  );
  const dormancyHours = Number.parseInt(text(payload.dormancyHours) ?? "", 10);
  const rules: PriorityRules = {
    projectId: ctx.projectId,
    order: order.length > 0 ? order : DEFAULT_PRIORITY_RULES.order,
    agentYields: payload.agentYields !== false && payload.agentYields !== "false",
    hardMode: payload.hardMode === true || payload.hardMode === "true",
    dormancyHours:
      Number.isFinite(dormancyHours) && dormancyHours > 0
        ? dormancyHours
        : DEFAULT_PRIORITY_RULES.dormancyHours,
  };
  const saved = await ctx.stores.rules.set(rules);
  return ok("settings.saveRules", `passage rules saved (hard mode: ${saved.hardMode})`, saved);
}

async function onTokensGenerate(ctx: Ctx, deps: UiActionDeps) {
  const created = await deps.createToken(ctx, "personal");
  return ok("tokens.generate", "token generated — copy it now, it is shown once", created);
}

async function onTokensRevoke(ctx: Ctx, payload: Record<string, unknown>) {
  const tokenHash = text(payload.tokenHash);
  if (tokenHash === undefined) return refused("tokens.revoke", "tokenHash is required");
  const revoked = await ctx.stores.tokens.revoke(tokenHash);
  return revoked
    ? ok("tokens.revoke", "token revoked")
    : refused("tokens.revoke", "unknown token");
}

/* ------------------------------------------------------------------ */
/* The router                                                           */
/* ------------------------------------------------------------------ */

/**
 * Route one screen action. Identity comes from `contextOptions` (the Forge
 * product context), never from the payload (spec §9.6).
 */
export async function routeUiAction(
  request: UiActionRequest,
  contextOptions: BuildCtxOptions,
  deps: UiActionDeps = LIVE_UI_ACTION_DEPS,
): Promise<UiActionResult> {
  const payload = rec(request.payload);
  if (request.key === "simulation.run") return onSimulationRun(payload, deps);
  const ctx = await deps.buildCtx({ ...contextOptions, client: "ui" });
  switch (request.key) {
    case "collisions.resolve":
      return onResolve(ctx, payload, deps);
    case "worksites.iWorkOnIt":
      return onIWorkOnIt(ctx, payload, deps);
    case "settings.saveZone":
      return onSaveZone(ctx, payload);
    case "settings.saveRules":
      return onSaveRules(ctx, payload);
    case "tokens.generate":
      return onTokensGenerate(ctx, deps);
    case "tokens.revoke":
      return onTokensRevoke(ctx, payload);
    default:
      return refused(request.key, `unknown action key (expected one of: ${UI_ACTION_KEYS.join(", ")})`);
  }
}
