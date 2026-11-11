/**
 * glue/ui-data — the DATA of the screens that need more than a service call:
 * the worksite map, the project settings (hook file + CI snippets, with the
 * real web trigger URL) and the personal settings (my worksites, my sessions,
 * my token fingerprints). Owner: workstream I (glue).
 *
 * These functions return data only; `glue/ui-resolvers.ts` renders them through
 * the screens of workstreams J/K (`glue/ui-registry.ts`).
 */

import { webTrigger } from "@forge/api";
import type {
  ActorSession,
  Degree,
  HookToken,
  Locale,
  MapNode,
  PriorityRules,
  RepoRecord,
  Worksite,
  WorksiteMapData,
  Zone,
} from "../core/types";
import { parentDirs } from "../core/paths";
import { zoneForPath } from "../core/zones";
import type { Ctx } from "../services/ctx";
import { learningReport, type LearningReport } from "../services/learning";
import { measureParallelWidth } from "../services/width";
import { createToken, type CreatedToken } from "../services/tokens";
import { buildNeighborInfo, normalizeSlug } from "../services/shared";
import { ciSnippets, hooksSettingsFile, type CiSnippet } from "./templates";

/** Key of the web trigger module declared in manifest.yml. */
export const INGEST_MODULE_KEY = "ingest";
/** Shown when the installation URL cannot be resolved (no installation yet). */
export const INGEST_URL_PLACEHOLDER =
  "https://<INSTALLATION>.webtrigger.atlassian.app/v2/<APP_ID>/ingest";
/** A token fingerprint: the hash prefix, never the clear value (spec §17). */
const HASH_PREFIX = 8;

export interface TokenView {
  /** sha256 fingerprint (never the clear value) — the key used to revoke it. */
  tokenHash: string;
  /** Short display form of the fingerprint. */
  tokenHashPrefix: string;
  scope: HookToken["scope"];
  projectId?: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** A worksite of the caller, labelled for humans (screen `MyWorksite`). */
export type MyWorksiteView = Worksite & { actorLabel: string; repoSlug?: string };

export interface ProjectSettingsData {
  projectId: string;
  repos: RepoRecord[];
  zones: Zone[];
  rules: PriorityRules;
  ingestUrl: string;
  hooksFile: string;
  ciSnippets: CiSnippet[];
  /** Learning loop (CC-25): prediction accuracy + zone reclassifications. */
  learning?: LearningReport;
}

export interface PersonalSettingsData {
  myWorksites: MyWorksiteView[];
  mySessions: ActorSession[];
  tokens: TokenView[];
  /** Clear value, returned ONCE, right after creation (spec §17). */
  newToken?: CreatedToken;
  now: string;
}

/** The installation's ingest URL (`webTrigger.getUrl`), placeholder on failure. */
export async function ingestBaseUrl(): Promise<string> {
  try {
    const url = await webTrigger.getUrl(INGEST_MODULE_KEY);
    return url === undefined || url === "" ? INGEST_URL_PLACEHOLDER : url.replace(/\/+$/, "");
  } catch {
    return INGEST_URL_PLACEHOLDER;
  }
}

/* ------------------------------------------------------------------ */
/* Map (jira:projectPage)                                               */
/* ------------------------------------------------------------------ */

/** The repo of the map: the requested slug, else the project's first repo. */
async function mapRepo(ctx: Ctx, repoSlug?: string): Promise<RepoRecord | undefined> {
  if (repoSlug !== undefined && repoSlug !== "") {
    const found = await ctx.stores.repos.findBySlug(ctx.projectId, normalizeSlug(repoSlug));
    if (found !== undefined) return found;
  }
  const repos = await ctx.stores.repos.listByProject(ctx.projectId);
  return repos[0];
}

function nodeFor(nodes: Map<string, MapNode>, path: string, kind: MapNode["kind"]): MapNode {
  const existing = nodes.get(path);
  if (existing !== undefined) return existing;
  const created: MapNode = { path, kind, worksiteIds: [] };
  nodes.set(path, created);
  return created;
}

function occupy(nodes: Map<string, MapNode>, path: string, kind: MapNode["kind"], worksiteId: string): void {
  const node = nodeFor(nodes, path, kind);
  if (!node.worksiteIds.includes(worksiteId)) node.worksiteIds.push(worksiteId);
  for (const parent of parentDirs(path)) {
    const parentNode = nodeFor(nodes, parent, "dir");
    if (!parentNode.worksiteIds.includes(worksiteId)) parentNode.worksiteIds.push(worksiteId);
  }
}

/** A collision colours its path AND its parent directories (worst degree). */
function colour(nodes: Map<string, MapNode>, path: string, degree: Degree): void {
  for (const candidate of [path, ...parentDirs(path)]) {
    const node = nodes.get(candidate);
    if (node === undefined) continue;
    if (node.worstDegree === undefined || degree > node.worstDegree) node.worstDegree = degree;
  }
}

/**
 * WorksiteMapData: one node per footprint path of the open worksites (plus
 * their parent directories), coloured by the worst ACTIVE collision degree,
 * with the zone each node belongs to.
 */
export async function mapData(ctx: Ctx, options: { repoSlug?: string; locale?: Locale } = {}): Promise<WorksiteMapData> {
  const locale = options.locale ?? "en";
  const repo = await mapRepo(ctx, options.repoSlug);
  if (repo === undefined) return { repoSlug: options.repoSlug ?? "", nodes: [], worksites: [] };
  const zones = await ctx.stores.zones.listByRepo(repo.id);
  const nodes = new Map<string, MapNode>();
  const worksites: WorksiteMapData["worksites"] = [];
  for (const worksite of await ctx.stores.worksites.listOpenByRepo(repo.id)) {
    const neighbor = await buildNeighborInfo(ctx, worksite, locale);
    worksites.push({ ...worksite, actorLabel: neighbor.actorLabel });
    for (const entry of await ctx.stores.footprints.listByWorksite(worksite.id)) {
      occupy(nodes, entry.path, entry.kind, worksite.id);
    }
  }
  for (const collision of await ctx.stores.collisions.listByRepo(repo.id, true)) {
    colour(nodes, collision.path, collision.degree);
  }
  for (const node of nodes.values()) {
    const zone = zoneForPath(zones, node.path);
    if (zone !== undefined) {
      node.zoneName = zone.name;
      node.zoneNature = zone.nature;
    }
  }
  // Parallel width (spec §27) — best effort: the map still renders without it.
  const width = await measureParallelWidth(ctx, { repoSlug: repo.slug }).catch(() => undefined);
  return { repoSlug: repo.slug, nodes: [...nodes.values()], worksites, width };
}

/* ------------------------------------------------------------------ */
/* Project settings (jira:projectSettingsPage)                          */
/* ------------------------------------------------------------------ */

export async function projectSettingsData(ctx: Ctx): Promise<ProjectSettingsData> {
  const repos = await ctx.stores.repos.listByProject(ctx.projectId);
  const zones: Zone[] = [];
  for (const repo of repos) zones.push(...(await ctx.stores.zones.listByRepo(repo.id)));
  const rules = await ctx.stores.rules.get(ctx.projectId);
  const ingestUrl = await ingestBaseUrl();
  const learning = await learningReport(ctx).catch(() => undefined);
  return {
    projectId: ctx.projectId,
    repos,
    zones,
    rules,
    ingestUrl,
    hooksFile: hooksSettingsFile(ingestUrl),
    ciSnippets: ciSnippets(ingestUrl),
    learning,
  };
}

/* ------------------------------------------------------------------ */
/* Personal settings (jira:personalSettingsPage)                        */
/* ------------------------------------------------------------------ */

function tokenView(token: HookToken): TokenView {
  const view: TokenView = {
    tokenHash: token.tokenHash,
    tokenHashPrefix: `${token.tokenHash.slice(0, HASH_PREFIX)}…`,
    scope: token.scope,
    createdAt: token.createdAt,
  };
  if (token.projectId !== undefined) view.projectId = token.projectId;
  if (token.lastUsedAt !== undefined) view.lastUsedAt = token.lastUsedAt;
  return view;
}

/** My worksites, labelled, with the slug of their repository. */
async function myWorksitesOf(ctx: Ctx, accountId: string, locale: Locale): Promise<MyWorksiteView[]> {
  const out: MyWorksiteView[] = [];
  for (const worksite of await ctx.stores.worksites.listByAccount(accountId)) {
    const neighbor = await buildNeighborInfo(ctx, worksite, locale);
    const repo = await ctx.stores.repos.findById(worksite.repoId);
    const view: MyWorksiteView = { ...worksite, actorLabel: neighbor.actorLabel };
    if (repo !== undefined) view.repoSlug = repo.slug;
    out.push(view);
  }
  return out;
}

/**
 * My worksites, my agent sessions and my token FINGERPRINTS (never the clear
 * value). `createToken` is set when the screen asks for a new one: the clear
 * value comes back once, in `newToken`.
 */
export async function personalSettingsData(
  ctx: Ctx,
  options: { createToken?: HookToken["scope"]; locale?: Locale } = {},
): Promise<PersonalSettingsData> {
  const accountId = ctx.identity.accountId;
  const locale = options.locale ?? "en";
  const [myWorksites, mySessions, stored] = await Promise.all([
    myWorksitesOf(ctx, accountId, locale),
    ctx.stores.sessions.listByAccount(accountId),
    ctx.stores.tokens.listByAccount(accountId),
  ]);
  const data: PersonalSettingsData = {
    myWorksites,
    mySessions,
    tokens: stored.map(tokenView),
    now: ctx.now(),
  };
  if (options.createToken !== undefined) data.newToken = await createToken(ctx, options.createToken);
  return data;
}
