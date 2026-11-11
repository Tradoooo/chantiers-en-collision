/**
 * glue/ui-resolvers — the `main` UI function of manifest.yml: ONE function,
 * seven screens. Owner: workstream I (glue).
 *
 * How it works (UI kit 1, `@forge/ui`):
 *   `export const main = render(<UiRoot/>)` — Forge calls `main(payload,
 *   runtimeContext)`; the root component reads the product context with
 *   `useProductContext()`, the glue turns it into a Ctx (identity = the Forge
 *   context account, never an input, spec §9.6), loads the screen's DATA with
 *   `useState(async …)` and hands the screen component of workstreams J/K the
 *   exact props it declares (through `glue/ui-registry.ts`).
 *
 * `loadScreen(module, product, payload)` is the single place where a screen's
 * data AND its props are assembled; `uiData(...)` exposes the data alone (used
 * by the resolver keys wired in src/index.ts: `issuePanelData`, `mapData`,
 * `sprintCheckData`, `gadgetData`, `projectSettingsData`,
 * `personalSettingsData`, `simulationData`).
 */

import ForgeUI, { Fragment, Heading, Text, render, useProductContext, useState } from "@forge/ui";
import type {
  SimulationResult,
  SimulationScenario,
  WorksitePanel,
  Zone,
} from "../core/types";
import type { Ctx } from "../services/ctx";
import { collisionStats, sprintCheck } from "../services/planning";
import { getWorksitePanel } from "../services/worksites";
import { buildCtx, type BuildCtxOptions, type ForgeInvocationContext } from "../forge-context";
import { MCP_TOOLS, ToolInputError, type ToolResult } from "./resolvers-mcp";
import {
  mapData,
  personalSettingsData,
  projectSettingsData,
  type PersonalSettingsData,
  type ProjectSettingsData,
} from "./ui-data";
import {
  routeUiAction,
  LIVE_UI_ACTION_DEPS,
  type UiActionResult,
  type UiActionDeps,
} from "./ui-actions";
import { screenFor, type UiElement } from "./ui-registry";

export type UiModule =
  | "issuePanel"
  | "map"
  | "sprintCheck"
  | "gadget"
  | "projectSettings"
  | "personalSettings"
  | "simulation";

/** The shape `useProductContext()` gives us (kept loose: UI kit fills it in). */
export type ProductContextLike = ReturnType<typeof useProductContext> | undefined;

export interface UiDataDeps {
  buildCtx(options: BuildCtxOptions): Promise<Ctx>;
  getWorksitePanel: typeof getWorksitePanel;
  sprintCheck: typeof sprintCheck;
  collisionStats: typeof collisionStats;
  mapData: typeof mapData;
  projectSettingsData: typeof projectSettingsData;
  personalSettingsData: typeof personalSettingsData;
  actionDeps: UiActionDeps;
  scenarios: SimulationScenario[];
  runScenario: (scenario: SimulationScenario) => Promise<SimulationResult>;
}

export const LIVE_UI_DEPS: UiDataDeps = {
  buildCtx,
  getWorksitePanel,
  sprintCheck,
  collisionStats,
  mapData,
  projectSettingsData,
  personalSettingsData,
  actionDeps: LIVE_UI_ACTION_DEPS,
  scenarios: LIVE_UI_ACTION_DEPS.scenarios,
  runScenario: LIVE_UI_ACTION_DEPS.runScenario,
};

/** Resolver keys wired in src/index.ts, one per screen's data. */
export const UI_DATA_KEYS: Record<UiModule, string> = {
  issuePanel: "issuePanelData",
  map: "mapData",
  sprintCheck: "sprintCheckData",
  gadget: "gadgetData",
  projectSettings: "projectSettingsData",
  personalSettings: "personalSettingsData",
  simulation: "simulationData",
};

/** manifest module key → screen (a resolver payload may also name it). */
const MODULE_BY_KEY: Record<string, UiModule> = {
  "worksite-panel": "issuePanel",
  "worksite-map": "map",
  "sprint-check": "sprintCheck",
  "project-settings": "projectSettings",
  "personal-settings": "personalSettings",
  "collision-stats": "gadget",
  simulation: "simulation",
};

/** manifest module TYPE → screen (what the product context reports). */
const MODULE_BY_TYPE: Record<string, UiModule> = {
  "jira:issuePanel": "issuePanel",
  "jira:projectPage": "map",
  "jira:sprintAction": "sprintCheck",
  "jira:projectSettingsPage": "projectSettings",
  "jira:personalSettingsPage": "personalSettings",
  "jira:dashboardGadget": "gadget",
};

/* ------------------------------------------------------------------ */
/* Reading the product context (tolerant: UI kit nests it differently   */
/* per module, and a resolver payload may carry the same fields)        */
/* ------------------------------------------------------------------ */

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function extensionOf(product: ProductContextLike): Record<string, unknown> {
  return rec(rec(product).extensionContext);
}

function platformOf(product: ProductContextLike): Record<string, unknown> {
  const platform = rec(rec(product).platformContext);
  return { ...platform, ...rec(platform.jira) };
}

/** Explicit module asked by a resolver payload, else the manifest key/type. */
export function detectModule(product: ProductContextLike, payload?: unknown): UiModule {
  const asked = text(rec(payload).module);
  if (asked !== undefined && asked in MODULE_BY_KEY) return MODULE_BY_KEY[asked];
  if (asked !== undefined && (Object.values(MODULE_BY_KEY) as string[]).includes(asked)) {
    return asked as UiModule;
  }
  const moduleKey = text(rec(product).moduleKey);
  if (moduleKey !== undefined && moduleKey in MODULE_BY_KEY) return MODULE_BY_KEY[moduleKey];
  const type = text(extensionOf(product).type) ?? text(platformOf(product).type);
  if (type !== undefined && type in MODULE_BY_TYPE) return MODULE_BY_TYPE[type];
  return "issuePanel";
}

export function issueKeyOf(product: ProductContextLike, payload?: unknown): string | undefined {
  const extension = extensionOf(product);
  return (
    text(rec(payload).issueKey) ??
    text(extension.issueKey) ??
    text(rec(extension.issue).key) ??
    text(platformOf(product).issueKey)
  );
}

function projectKeyOf(product: ProductContextLike, payload?: unknown): string | undefined {
  const extension = extensionOf(product);
  return (
    text(rec(payload).projectKey) ??
    text(extension.projectKey) ??
    text(rec(extension.project).key) ??
    text(platformOf(product).projectKey)
  );
}

/** Sprint action / issue navigator: the selected tickets. */
function issueKeysOf(product: ProductContextLike, payload?: unknown): string[] {
  const extension = extensionOf(product);
  const raw = rec(payload).issueKeys ?? extension.issueKeys ?? extension.issues;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => text(entry) ?? text(rec(entry).key) ?? text(rec(entry).issueKey))
    .filter((key): key is string => key !== undefined);
}

function tokenScopeOf(value: unknown): "personal" | "project" | undefined {
  const scope = text(value)?.toLowerCase();
  return scope === "personal" || scope === "project" ? scope : undefined;
}

function ctxOptionsOf(product: ProductContextLike, payload: unknown): BuildCtxOptions {
  const issueKey = issueKeyOf(product, payload);
  const projectId = projectKeyOf(product, payload);
  return {
    context: { accountId: text(rec(product).accountId), issueKey, projectKey: projectId },
    client: "ui",
    issueKey,
    projectId,
  };
}

async function ctxForUi(
  product: ProductContextLike,
  payload: unknown,
  deps: UiDataDeps,
): Promise<Ctx> {
  return deps.buildCtx(ctxOptionsOf(product, payload));
}

/* ------------------------------------------------------------------ */
/* Screen data + props                                                  */
/* ------------------------------------------------------------------ */

/** A screen's data, plus the exact props object its component declares. */
export interface ScreenLoad {
  data: unknown;
  props: Record<string, unknown>;
}

async function zonesOfPanel(ctx: Ctx, panel: WorksitePanel): Promise<Zone[]> {
  const zones: Zone[] = [];
  for (const entry of panel.repos) {
    zones.push(...(await ctx.stores.zones.listByRepo(entry.repo.id)));
  }
  return zones;
}

async function simulationScreen(
  payload: Record<string, unknown>,
  deps: UiDataDeps,
): Promise<ScreenLoad> {
  const key = text(payload.scenarioKey);
  const scenario = key === undefined ? undefined : deps.scenarios.find((entry) => entry.key === key);
  const data: { scenarios: SimulationScenario[]; result?: SimulationResult } = {
    scenarios: deps.scenarios,
  };
  if (scenario !== undefined) data.result = await deps.runScenario(scenario);
  return { data, props: { ...data } };
}

/** Data + props of a screen: ONE place, so the two never drift apart. */
export async function loadScreen(
  module: UiModule,
  product: ProductContextLike,
  payload?: unknown,
  deps: UiDataDeps = LIVE_UI_DEPS,
): Promise<ScreenLoad> {
  const body = rec(payload);
  if (module === "simulation") return simulationScreen(body, deps);
  const ctx = await ctxForUi(product, body, deps);
  const repoSlug = text(body.repoSlug) ?? text(body.repo);
  const now = ctx.now();
  switch (module) {
    case "issuePanel": {
      const panel = await deps.getWorksitePanel(ctx, issueKeyOf(product, body) ?? "");
      return { data: panel, props: { panel, zones: await zonesOfPanel(ctx, panel), now } };
    }
    case "map": {
      const data = await deps.mapData(ctx, { repoSlug });
      return { data, props: { data, now } };
    }
    case "sprintCheck": {
      const data = await deps.sprintCheck(ctx, issueKeysOf(product, body));
      return { data, props: { data } };
    }
    case "gadget": {
      const stats = await deps.collisionStats(ctx, { repoSlug, since: text(body.since) });
      return { data: stats, props: { stats } };
    }
    case "projectSettings":
      return projectSettingsScreen(deps, ctx);
    default:
      return personalSettingsScreen(deps, ctx, body);
  }
}

async function projectSettingsScreen(
  deps: UiDataDeps,
  ctx: Ctx,
): Promise<ScreenLoad> {
  const settings: ProjectSettingsData = await deps.projectSettingsData(ctx);
  // The screen's declared props (src/ui/projectSettings.tsx) — `projectId`
  // and `ingestUrl` stay in `data`, they are not part of the props.
  const props: Record<string, unknown> = {
    repos: settings.repos,
    zones: settings.zones,
    rules: settings.rules,
    hooksFile: settings.hooksFile,
    ciSnippets: settings.ciSnippets,
  };
  if (settings.learning !== undefined) props.learning = settings.learning;
  return { data: settings, props };
}

async function personalSettingsScreen(
  deps: UiDataDeps,
  ctx: Ctx,
  body: Record<string, unknown>,
): Promise<ScreenLoad> {
  const settings: PersonalSettingsData = await deps.personalSettingsData(ctx, {
    createToken: tokenScopeOf(body.createToken),
  });
  const newToken = settings.newToken?.token;
  const props: Record<string, unknown> = {
    myWorksites: settings.myWorksites,
    mySessions: settings.mySessions,
    tokens: settings.tokens,
    now: settings.now,
  };
  if (newToken !== undefined) props.newToken = newToken;
  return { data: settings, props };
}

/** The DATA of a screen (resolver keys, tests, and the fallback panel). */
export async function uiData(
  module: UiModule,
  product: ProductContextLike,
  payload?: unknown,
  deps: UiDataDeps = LIVE_UI_DEPS,
): Promise<unknown> {
  return (await loadScreen(module, product, payload, deps)).data;
}

/* ------------------------------------------------------------------ */
/* Actions: what a screen may DO. Screens cannot import @forge/* (rule 4 */
/* of docs/CONTRACTS.md), so identity, stores and services stay behind   */
/* this prop — to be used inside `useAction`.                          */
/* ------------------------------------------------------------------ */

export interface UiActions {
  /** Route a screen action message (`{key, payload}`) — see glue/ui-actions. */
  route(key: string, payload?: Record<string, unknown>): Promise<UiActionResult>;
  /** Any of the 13 MCP tools, by manifest key (`declare-footprint`…). */
  tool(key: string, payload?: Record<string, unknown>): Promise<ToolResult>;
  /** Reload a screen's data (default: the current screen). */
  data(module?: UiModule, payload?: Record<string, unknown>): Promise<unknown>;
}

export function uiActions(
  product: ProductContextLike,
  deps: UiDataDeps = LIVE_UI_DEPS,
): UiActions {
  const options = ctxOptionsOf(product, undefined);
  return {
    async route(key, payload) {
      return routeUiAction({ key, payload }, options, deps.actionDeps);
    },
    async tool(key, payload) {
      const handler = MCP_TOOLS[key];
      if (handler === undefined) throw new ToolInputError(`unknown tool: ${key}`);
      return handler({
        payload: payload ?? {},
        context: options.context as ForgeInvocationContext,
      });
    },
    async data(module, payload) {
      return uiData(module ?? detectModule(product), product, payload ?? {}, deps);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                            */
/* ------------------------------------------------------------------ */

/** UI kit 1 types its components narrowly; the glue builds elements by hand. */
type LooseComponent = (props: Record<string, unknown>) => UiElement;
const TextEl = Text as unknown as LooseComponent;
const FragmentEl = Fragment as unknown as LooseComponent;
const HeadingEl = Heading as unknown as LooseComponent;

function element(component: LooseComponent, props: Record<string, unknown>): UiElement {
  return ForgeUI.createElement<Record<string, unknown>>(component, props);
}

function textElement(content: string): UiElement {
  return element(TextEl, { content });
}

/** One-line summary of the loaded data, for the fallback panel. */
export function dataSummary(module: UiModule, data: unknown): string {
  const value = rec(data);
  switch (module) {
    case "issuePanel":
      return `ticket ${text(value.issueKey) ?? "?"} · ${count(value.repos)} repo(s)`;
    case "map":
      return `repo ${text(value.repoSlug) ?? "?"} · ${count(value.nodes)} path(s) · ${count(value.worksites)} worksite(s)`;
    case "sprintCheck":
      return `${count(value.tickets)} ticket(s) · ${count(value.hinges)} hinge(s)`;
    case "gadget":
      return `before code ${num(value.seenBeforeCode)} · live ${num(value.seenWhileWorking)} · PR ${num(value.seenAtPr)} · missed ${num(value.missedUntilMerge)}`;
    case "projectSettings":
      return `${count(value.repos)} repo(s) · ${count(value.zones)} zone(s)`;
    case "personalSettings":
      return `${count(value.myWorksites)} worksite(s) · ${count(value.tokens)} token(s)`;
    default:
      return `${count(value.scenarios)} scenario(s)`;
  }
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/** Shown while a screen of workstream J/K is not available. */
function fallback(module: UiModule, data: unknown): UiElement {
  return element(FragmentEl, {
    children: [
      element(HeadingEl, { size: "medium", children: "Chantiers en collision" }),
      textElement(`${module} · ${dataSummary(module, data)}`),
      textElement("screen unavailable — data loaded and ready"),
    ],
  });
}

function loading(): UiElement {
  return element(FragmentEl, { children: [textElement("loading worksites…")] });
}

/** Root component: detect the screen from the product context, load and render. */
function UiRoot(): UiElement {
  const product = useProductContext();
  const module = detectModule(product);
  const [screen] = useState(async () => loadScreen(module, product));
  if (screen === undefined) return loading();
  const props = { ...screen.props, data: screen.data, actions: uiActions(product) };
  return screenFor(module, props) ?? fallback(module, screen.data);
}

/** The `main` function of manifest.yml (every UI module points at it). */
export const main = render(ForgeUI.createElement(UiRoot, {}));
