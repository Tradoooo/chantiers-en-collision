/**
 * glue/jira-port — the JiraPort implementation over `@forge/api requestJira`.
 * Owner: workstream I (glue). Nothing here is called from tests: services get a
 * fake port (plain object) per docs/CONTRACTS.md.
 *
 * DECISIONS (documented, best effort everywhere):
 *  - Caller: `requestJira` (the calling user) when a user is known — MCP tool
 *    and UI screens — and `asApp().requestJira` when there is no user (web
 *    trigger, trigger, scheduled trigger, where Forge gives no user context).
 *    Nothing is ever attributed from a tool input (spec §9.6).
 *  - searchIssues uses POST /rest/api/3/search/jql (the /rest/api/3/search
 *    endpoint is deprecated) with the fields the domain needs: summary,
 *    priority, duedate, components, status. `TicketMeta.incident` cannot be
 *    derived from a search, so it stays undefined (the panel/rules treat it as
 *    "not an incident"); an incident link would need a per-issue link query.
 *  - priorityRank: Jira priority `id` when numeric (1 = highest in the default
 *    scheme, lower = more urgent), else the priority name mapped on the default
 *    scheme. Best effort: an unknown priority yields no rank.
 *  - setCollisionsField writes the `jira:customField` declared in manifest.yml
 *    (key `collisions-field`). Forge assigns the real field id at install time,
 *    so it is resolved once per container: env override first
 *    (CHANTIERS_COLLISIONS_FIELD_ID), else GET /rest/api/3/field matched on the
 *    field name. Unresolvable → the write is skipped, never fatal.
 *  - mergedHistory does NOT use Jira: the Jira/Teamwork Graph REST API exposes
 *    no list of changed files for a merged ticket (spec §19), so the history is
 *    rebuilt from our own stores (closed worksites with outcome "merged" and
 *    their attested footprints).
 */

import { asApp, requestJira, route } from "@forge/api";
import type { APIResponse, RequestInit, RequestProductMethod } from "@forge/api";
import type { Route } from "@forge/api";
import type { MergedTicketHistory, TicketMeta, Worksite } from "../core/types";
import type { JiraPort } from "../services/ctx";
import { normalizeSlug } from "../services/shared";
import type { Stores } from "../storage/interfaces";

/** Name of the custom field declared as `modules.jira:customField` (manifest). */
export const COLLISIONS_FIELD_NAME = "Collisions";
/** Env override for the resolved field id (Forge assigns it at install time). */
export const COLLISIONS_FIELD_ENV = "CHANTIERS_COLLISIONS_FIELD_ID";
/** Jira link type used for "is blocked by" (resolution choice `sequence`). */
const BLOCK_LINK_TYPE = "Blocks";
/** Fields asked from the search endpoint — everything TicketMeta can carry. */
const SEARCH_FIELDS = ["summary", "priority", "duedate", "components", "status"];
const MAX_RESULTS = 50;
/** Journal depth scanned when rebuilding the merged-ticket history. */
const HISTORY_EVENT_LIMIT = 500;
const HISTORY_MAX_TICKETS = 100;
const PRIORITY_NAME_RANK: Record<string, number> = {
  highest: 1,
  high: 2,
  medium: 3,
  low: 4,
  lowest: 5,
};

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

/* ------------------------------------------------------------------ */
/* Small JSON helpers (the REST payloads are untyped)                   */
/* ------------------------------------------------------------------ */

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Lower = more urgent; unknown priority → no rank at all. */
function priorityRankOf(priority: Record<string, unknown>): number | undefined {
  const id = text(priority.id);
  if (id !== undefined && /^\d+$/.test(id)) return Number(id);
  const name = text(priority.name)?.toLowerCase();
  return name === undefined ? undefined : PRIORITY_NAME_RANK[name];
}

/** One REST issue → the domain snapshot used by prediction and priority. */
export function toTicketMeta(raw: unknown): TicketMeta {
  const issue = rec(raw);
  const fields = rec(issue.fields);
  const components = list(fields.components)
    .map((component) => text(rec(component).name))
    .filter((name): name is string => name !== undefined);
  return {
    issueKey: text(issue.key) ?? "",
    issueId: text(issue.id),
    summary: text(fields.summary),
    priorityRank: priorityRankOf(rec(fields.priority)),
    dueAt: text(fields.duedate),
    components,
    status: text(rec(fields.status).name),
  };
}

/** Plain text → the Atlassian Document Format a v3 comment body requires. */
export function adfFromText(body: string): unknown {
  const lines = body.split("\n");
  const content = lines
    .filter((line) => line.trim() !== "")
    .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));
  return { type: "doc", version: 1, content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

async function call(
  request: RequestProductMethod,
  path: Route,
  init?: RequestInit,
): Promise<{ ok: boolean; json: unknown }> {
  const response: APIResponse = await request(path, init);
  if (!response.ok) return { ok: false, json: undefined };
  try {
    return { ok: true, json: await response.json() };
  } catch {
    return { ok: true, json: undefined };
  }
}

/* ------------------------------------------------------------------ */
/* The port                                                             */
/* ------------------------------------------------------------------ */

export interface JiraPortOptions {
  stores: Stores;
  /** Jira project key the caller belongs to (scopes the merged history). */
  projectId: string;
  /** Present for MCP/UI calls: act as that user. Absent → act as the app. */
  accountId?: string;
}

/** Resolve the "Collisions" custom field id once per container (best effort). */
function makeFieldIdResolver(request: RequestProductMethod): () => Promise<string | undefined> {
  let cached: Promise<string | undefined> | undefined;
  return () => {
    const fromEnv = text(process.env[COLLISIONS_FIELD_ENV]);
    if (fromEnv !== undefined) return Promise.resolve(fromEnv);
    cached ??= (async () => {
      const { ok, json } = await call(request, route`/rest/api/3/field`);
      if (!ok) return undefined;
      const found = list(json).find(
        (field) => text(rec(field).name) === COLLISIONS_FIELD_NAME,
      );
      return found === undefined ? undefined : text(rec(found).id);
    })();
    return cached;
  };
}

/** What the six port methods share: how to call Jira, and whose data it is. */
interface JiraClient {
  request: RequestProductMethod;
  /** Resolved `customfield_xxxxx` id of the "Collisions" field (best effort). */
  fieldId(): Promise<string | undefined>;
  stores: Stores;
  projectId: string;
}

async function searchIssues(client: JiraClient, jql: string): Promise<TicketMeta[]> {
  const { ok, json } = await call(client.request, route`/rest/api/3/search/jql`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ jql, fields: SEARCH_FIELDS, maxResults: MAX_RESULTS }),
  });
  if (!ok) return [];
  return list(rec(json).issues)
    .map(toTicketMeta)
    .filter((ticket) => ticket.issueKey !== "");
}

async function getIssue(client: JiraClient, issueKey: string): Promise<TicketMeta | undefined> {
  const key = encodeURIComponent(issueKey);
  const { ok, json } = await call(
    client.request,
    route`/rest/api/3/issue/${key}?fields=${SEARCH_FIELDS.join(",")}`,
  );
  return ok ? toTicketMeta(json) : undefined;
}

async function setCollisionsField(
  client: JiraClient,
  issueKey: string,
  value: string,
): Promise<void> {
  const id = await client.fieldId();
  if (id === undefined) return; // field not resolvable: skip, never fatal
  const key = encodeURIComponent(issueKey);
  await call(client.request, route`/rest/api/3/issue/${key}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ fields: { [id]: value } }),
  });
}

/** "is blocked by": inwardIssue is the blocked ticket, outwardIssue the blocker. */
async function createIssueLink(
  client: JiraClient,
  blocked: string,
  blocker: string,
): Promise<void> {
  await call(client.request, route`/rest/api/3/issueLink`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      type: { name: BLOCK_LINK_TYPE },
      inwardIssue: { key: blocked },
      outwardIssue: { key: blocker },
    }),
  });
}

async function commentOnIssue(client: JiraClient, issueKey: string, body: string): Promise<void> {
  const key = encodeURIComponent(issueKey);
  await call(client.request, route`/rest/api/3/issue/${key}/comment`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ body: adfFromText(body) }),
  });
}

async function mergedHistory(client: JiraClient, repoSlug: string): Promise<MergedTicketHistory[]> {
  const repo = await client.stores.repos.findBySlug(client.projectId, normalizeSlug(repoSlug));
  if (repo === undefined) return [];
  const byIssue = new Map<string, MergedTicketHistory>();
  for (const id of await candidateWorksiteIds(client.stores, repo.id)) {
    const worksite = await client.stores.worksites.findById(id);
    if (!isMergedInRepo(worksite, repo.id)) continue;
    const entry = await historyOf(client.stores, worksite as Worksite);
    if (entry === undefined) continue;
    const previous = byIssue.get(entry.issueKey);
    if (previous === undefined || previous.paths.length < entry.paths.length) {
      byIssue.set(entry.issueKey, entry);
    }
    if (byIssue.size >= HISTORY_MAX_TICKETS) break;
  }
  return [...byIssue.values()];
}

/**
 * Build the JiraPort bound to one invocation context. Every method is best
 * effort: a Jira failure never breaks a verdict, a panel or a hook response.
 */
export function makeJiraPort(options: JiraPortOptions): JiraPort {
  const request: RequestProductMethod = options.accountId ? requestJira : asApp().requestJira;
  const client: JiraClient = {
    request,
    fieldId: makeFieldIdResolver(request),
    stores: options.stores,
    projectId: options.projectId,
  };
  return {
    searchIssues: (jql) => searchIssues(client, jql),
    getIssue: (issueKey) => getIssue(client, issueKey),
    setCollisionsField: (issueKey, value) => setCollisionsField(client, issueKey, value),
    createIssueLink: (blocked, blocker) => createIssueLink(client, blocked, blocker),
    commentOnIssue: (issueKey, body) => commentOnIssue(client, issueKey, body),
    mergedHistory: (repoSlug) => mergedHistory(client, repoSlug),
  };
}

/**
 * Candidate worksite ids of a repo, including CLOSED ones: the store interface
 * only lists non-closed worksites (see the gap reported to the orchestrator),
 * so closed merged worksites are recovered from the collision rows and from the
 * event journal, then verified with `findById`.
 */
async function candidateWorksiteIds(stores: Stores, repoId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const collision of await stores.collisions.listByRepo(repoId)) {
    ids.add(collision.worksiteA);
    ids.add(collision.worksiteB);
  }
  for (const event of await stores.events.recent(HISTORY_EVENT_LIMIT)) {
    if (event.worksiteId !== undefined && /clos|merg/i.test(event.kind)) ids.add(event.worksiteId);
  }
  return [...ids];
}

function isMergedInRepo(worksite: Worksite | undefined, repoId: string): boolean {
  return (
    worksite !== undefined &&
    worksite.repoId === repoId &&
    worksite.state === "closed" &&
    worksite.outcome === "merged"
  );
}

/** Attested paths of a merged worksite (declared/observed as a last resort). */
async function historyOf(
  stores: Stores,
  worksite: Worksite,
): Promise<MergedTicketHistory | undefined> {
  const entries = await stores.footprints.listByWorksite(worksite.id);
  const attested = entries.filter((entry) => entry.source === "attested");
  const chosen =
    attested.length > 0
      ? attested
      : entries.filter((entry) => entry.source !== "predicted");
  if (chosen.length === 0) return undefined;
  return {
    issueKey: worksite.issueKey,
    components: worksite.ticket?.components ?? [],
    summary: worksite.ticket?.summary,
    paths: [...new Set(chosen.map((entry) => entry.path))],
  };
}
