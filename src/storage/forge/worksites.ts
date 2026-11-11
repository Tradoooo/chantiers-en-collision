/**
 * storage/forge/worksites — WorksiteStore over Forge SQL.
 * Owner: workstream E.
 *
 * Semantics (src/storage/interfaces.ts + memory stub docstrings):
 *  - `create` generates an id when none is given;
 *  - `update` patches only the provided fields and returns the fresh row;
 *  - "non-closed" means `state <> 'closed'`;
 *  - `findByIssue` returns non-closed worksites only, newest first;
 *  - `findBySession` returns the most recent non-closed worksite of a session;
 *  - `listIdleBefore` / `listDormantBefore` filter on `last_activity_at`.
 */

import type { Worksite, WorksiteOutcome, WorksiteState } from "../../core/types";
import type { ActorKind, TicketMeta } from "../../core/types";
import type { WorksiteStore } from "../interfaces";
import {
  all,
  allText,
  bool,
  json,
  newId,
  one,
  optStr,
  parseJson,
  runText,
  str,
  upsert,
} from "./db";
import type { SqlScalar } from "./db";

interface WorksiteRow {
  id: string;
  issue_key: string;
  issue_id: string;
  repo_id: string;
  session_id: string;
  account_id: string;
  kind: string;
  branch: string;
  state: string;
  pr_open: number;
  pr_approved: number;
  opened_at: string;
  last_activity_at: string;
  closed_at: string;
  outcome: string;
  ticket: string;
  parent_worksite_id: string;
}

/** Domain field → column, in insert order. `id` is handled separately. */
const FIELDS: Array<[keyof Worksite, string]> = [
  ["issueKey", "issue_key"],
  ["issueId", "issue_id"],
  ["repoId", "repo_id"],
  ["sessionId", "session_id"],
  ["accountId", "account_id"],
  ["kind", "kind"],
  ["branch", "branch"],
  ["state", "state"],
  ["prOpen", "pr_open"],
  ["prApproved", "pr_approved"],
  ["openedAt", "opened_at"],
  ["lastActivityAt", "last_activity_at"],
  ["closedAt", "closed_at"],
  ["outcome", "outcome"],
  ["ticket", "ticket"],
  ["parentWorksiteId", "parent_worksite_id"],
];

function encodeField(field: keyof Worksite, value: unknown): SqlScalar {
  if (field === "ticket") return value === undefined || value === null ? "" : json(value);
  if (field === "prOpen" || field === "prApproved") return value ? 1 : 0;
  if (value === undefined || value === null) return "";
  return String(value);
}

/** Columns/values of the fields actually present in `source`. */
function columnsOf(source: Partial<Worksite>): { columns: string[]; values: SqlScalar[] } {
  const columns: string[] = [];
  const values: SqlScalar[] = [];
  FIELDS.forEach(([field, column]) => {
    if (!(field in source)) return;
    columns.push(column);
    values.push(encodeField(field, source[field]));
  });
  return { columns, values };
}

function toWorksite(row: WorksiteRow): Worksite {
  const worksite: Worksite = {
    id: str(row.id),
    issueKey: str(row.issue_key),
    repoId: str(row.repo_id),
    accountId: str(row.account_id),
    kind: str(row.kind) as ActorKind,
    state: str(row.state) as WorksiteState,
    openedAt: str(row.opened_at),
    lastActivityAt: str(row.last_activity_at),
  };
  const issueId = optStr(row.issue_id);
  if (issueId) worksite.issueId = issueId;
  const sessionId = optStr(row.session_id);
  if (sessionId) worksite.sessionId = sessionId;
  const branch = optStr(row.branch);
  if (branch) worksite.branch = branch;
  if (bool(row.pr_open)) worksite.prOpen = true;
  if (bool(row.pr_approved)) worksite.prApproved = true;
  const closedAt = optStr(row.closed_at);
  if (closedAt) worksite.closedAt = closedAt;
  const outcome = optStr(row.outcome);
  if (outcome) worksite.outcome = outcome as WorksiteOutcome;
  const parentWorksiteId = optStr(row.parent_worksite_id);
  if (parentWorksiteId) worksite.parentWorksiteId = parentWorksiteId;
  const ticket = parseJson<TicketMeta | null>(row.ticket, null);
  if (ticket) worksite.ticket = ticket;
  return worksite;
}

async function findWorksite(id: string): Promise<Worksite | undefined> {
  const row = await one<WorksiteRow>`SELECT * FROM worksite WHERE id = ${id}`;
  return row ? toWorksite(row) : undefined;
}

export function createWorksiteStore(): WorksiteStore {
  return {
    async create(w: Omit<Worksite, "id"> & { id?: string }): Promise<Worksite> {
      const id = w.id ?? newId("ws");
      const { columns, values } = columnsOf(w);
      await upsert("worksite", id, columns, values);
      return (await findWorksite(id)) ?? { ...w, id };
    },

    async update(id: string, patch: Partial<Worksite>): Promise<Worksite | undefined> {
      const { columns, values } = columnsOf(patch);
      if (columns.length > 0) {
        const assignments = columns.map((column) => `${column} = ?`).join(", ");
        await runText(`UPDATE worksite SET ${assignments} WHERE id = ?`, [...values, id]);
      }
      return findWorksite(id);
    },

    findById: findWorksite,

    async findBySession(sessionId: string): Promise<Worksite | undefined> {
      const row = await one<WorksiteRow>`
        SELECT * FROM worksite
        WHERE session_id = ${sessionId} AND state <> 'closed'
        ORDER BY last_activity_at DESC, opened_at DESC`;
      return row ? toWorksite(row) : undefined;
    },

    async findByIssue(
      issueKey: string,
      repoId?: string,
      sessionId?: string,
    ): Promise<Worksite[]> {
      let text = `SELECT * FROM worksite WHERE issue_key = ? AND state <> 'closed'`;
      const params: SqlScalar[] = [issueKey];
      if (repoId) {
        text += ` AND repo_id = ?`;
        params.push(repoId);
      }
      if (sessionId) {
        text += ` AND session_id = ?`;
        params.push(sessionId);
      }
      text += ` ORDER BY opened_at DESC`;
      const rows = await allText<WorksiteRow>(text, params);
      return rows.map(toWorksite);
    },

    async listOpenByRepo(repoId: string): Promise<Worksite[]> {
      const rows = await all<WorksiteRow>`
        SELECT * FROM worksite
        WHERE repo_id = ${repoId} AND state <> 'closed'
        ORDER BY opened_at DESC`;
      return rows.map(toWorksite);
    },

    async listByAccount(accountId: string): Promise<Worksite[]> {
      const rows = await all<WorksiteRow>`
        SELECT * FROM worksite WHERE account_id = ${accountId} ORDER BY opened_at DESC`;
      return rows.map(toWorksite);
    },

    async listIdleBefore(before: string): Promise<Worksite[]> {
      const rows = await all<WorksiteRow>`
        SELECT * FROM worksite
        WHERE state <> 'closed' AND last_activity_at < ${before}
        ORDER BY last_activity_at ASC`;
      return rows.map(toWorksite);
    },

    async listDormantBefore(before: string): Promise<Worksite[]> {
      const rows = await all<WorksiteRow>`
        SELECT * FROM worksite
        WHERE state = 'dormant' AND last_activity_at < ${before}
        ORDER BY last_activity_at ASC`;
      return rows.map(toWorksite);
    },
  };
}

/** Repo id of a worksite — used to denormalize footprint rows (spec §18). */
export async function repoIdOfWorksite(worksiteId: string): Promise<string> {
  const row = await one<{ repo_id: string }>`
    SELECT repo_id FROM worksite WHERE id = ${worksiteId}`;
  return row ? str(row.repo_id) : "";
}

/** Repo ids of several worksites, in one query. */
export async function repoIdsOfWorksites(worksiteIds: string[]): Promise<Record<string, string>> {
  if (worksiteIds.length === 0) return {};
  const rows = await all<{ id: string; repo_id: string }>`
    SELECT id, repo_id FROM worksite WHERE id IN (${worksiteIds})`;
  const map: Record<string, string> = {};
  rows.forEach((row) => {
    map[str(row.id)] = str(row.repo_id);
  });
  return map;
}
