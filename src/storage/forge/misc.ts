/**
 * storage/forge/misc — ConflictStore, TokenStore, EventStore and RulesStore
 * over Forge SQL.
 * Owner: workstream E.
 *
 * Semantics (src/storage/interfaces.ts):
 *  - conflicts are append-only and listed newest first, optionally scoped to a
 *    repo and to a `reported_at` lower bound;
 *  - a hook token is looked up by its sha256 hash (never by the clear value);
 *    `revoke` deletes the row and reports whether something was revoked;
 *  - events are appended with a monotonic `seq` and read newest first;
 *  - the priority rules of a project fall back to DEFAULT_PRIORITY_RULES.
 */

import { DEFAULT_PRIORITY_RULES } from "../../core/types";
import type {
  EventInput,
  EventRecord,
  HookToken,
  PriorityCriterion,
  PriorityRules,
  RealConflict,
} from "../../core/types";
import type { ConflictStore, EventStore, RulesStore, TokenStore } from "../interfaces";
import {
  all,
  allText,
  bool,
  insert,
  json,
  newId,
  num,
  one,
  optStr,
  parseJson,
  run,
  str,
  upsert,
  upsertByKey,
} from "./db";
import type { SqlScalar } from "./db";

/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

interface ConflictRow {
  id: string;
  repo_id: string;
  worksite_a: string;
  worksite_b: string;
  issue_key_a: string;
  issue_key_b: string;
  paths: string;
  was_detected: number;
  reported_at: string;
}

function toConflict(row: ConflictRow): RealConflict {
  const conflict: RealConflict = {
    id: str(row.id),
    repoId: str(row.repo_id),
    paths: parseJson<string[]>(row.paths, []),
    wasDetected: bool(row.was_detected),
    reportedAt: str(row.reported_at),
  };
  const worksiteA = optStr(row.worksite_a);
  if (worksiteA) conflict.worksiteA = worksiteA;
  const worksiteB = optStr(row.worksite_b);
  if (worksiteB) conflict.worksiteB = worksiteB;
  const issueKeyA = optStr(row.issue_key_a);
  if (issueKeyA) conflict.issueKeyA = issueKeyA;
  const issueKeyB = optStr(row.issue_key_b);
  if (issueKeyB) conflict.issueKeyB = issueKeyB;
  return conflict;
}

export function createConflictStore(): ConflictStore {
  return {
    async report(c: Omit<RealConflict, "id"> & { id?: string }): Promise<RealConflict> {
      const conflict: RealConflict = { ...c, id: c.id ?? newId("cf") };
      await upsert(
        "real_conflict",
        conflict.id,
        [
          "repo_id",
          "worksite_a",
          "worksite_b",
          "issue_key_a",
          "issue_key_b",
          "paths",
          "was_detected",
          "reported_at",
        ],
        [
          conflict.repoId,
          conflict.worksiteA ?? "",
          conflict.worksiteB ?? "",
          conflict.issueKeyA ?? "",
          conflict.issueKeyB ?? "",
          json(conflict.paths),
          conflict.wasDetected ? 1 : 0,
          conflict.reportedAt,
        ],
      );
      return conflict;
    },

    async list(repoId?: string, since?: string): Promise<RealConflict[]> {
      let text = `SELECT * FROM real_conflict WHERE 1 = 1`;
      const params: SqlScalar[] = [];
      if (repoId) {
        text += ` AND repo_id = ?`;
        params.push(repoId);
      }
      if (since) {
        text += ` AND reported_at >= ?`;
        params.push(since);
      }
      text += ` ORDER BY reported_at DESC`;
      const rows = await allText<ConflictRow>(text, params);
      return rows.map(toConflict);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Hook tokens                                                         */
/* ------------------------------------------------------------------ */

interface TokenRow {
  id: string;
  account_id: string;
  token_hash: string;
  scope: string;
  project_id: string;
  created_at: string;
  last_used_at: string;
}

function toToken(row: TokenRow): HookToken {
  const token: HookToken = {
    accountId: str(row.account_id),
    tokenHash: str(row.token_hash),
    scope: str(row.scope) as HookToken["scope"],
    createdAt: str(row.created_at),
  };
  const projectId = optStr(row.project_id);
  if (projectId) token.projectId = projectId;
  const lastUsedAt = optStr(row.last_used_at);
  if (lastUsedAt) token.lastUsedAt = lastUsedAt;
  return token;
}

export function createTokenStore(): TokenStore {
  return {
    async create(t: Omit<HookToken, "createdAt"> & { createdAt?: string }): Promise<HookToken> {
      const token: HookToken = { ...t, createdAt: t.createdAt ?? new Date().toISOString() };
      await upsert(
        "hook_token",
        newId("tok"),
        ["account_id", "token_hash", "scope", "project_id", "created_at", "last_used_at"],
        [
          token.accountId,
          token.tokenHash,
          token.scope,
          token.projectId ?? "",
          token.createdAt,
          token.lastUsedAt ?? "",
        ],
      );
      return token;
    },

    async findByHash(tokenHash: string): Promise<HookToken | undefined> {
      const row = await one<TokenRow>`
        SELECT * FROM hook_token WHERE token_hash = ${tokenHash}`;
      return row ? toToken(row) : undefined;
    },

    async touchLastUsed(tokenHash: string, at: string): Promise<void> {
      await run`UPDATE hook_token SET last_used_at = ${at} WHERE token_hash = ${tokenHash}`;
    },

    async listByAccount(accountId: string): Promise<HookToken[]> {
      const rows = await all<TokenRow>`
        SELECT * FROM hook_token WHERE account_id = ${accountId} ORDER BY created_at DESC`;
      return rows.map(toToken);
    },

    async revoke(tokenHash: string): Promise<boolean> {
      const affected = await run`DELETE FROM hook_token WHERE token_hash = ${tokenHash}`;
      return affected > 0;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

interface EventRow {
  seq: number;
  at: string;
  kind: string;
  worksite_id: string;
  payload_json: string;
}

function toEvent(row: EventRow): EventRecord {
  const event: EventRecord = {
    seq: num(row.seq),
    at: str(row.at),
    kind: str(row.kind),
  };
  const worksiteId = optStr(row.worksite_id);
  if (worksiteId) event.worksiteId = worksiteId;
  const payload = optStr(row.payload_json);
  if (payload) event.payloadJson = payload;
  return event;
}

/** Next sequence number (the table is AUTO_INCREMENT, this is the fallback). */
async function nextSeq(): Promise<number> {
  const row = await one<{ next: number }>`
    SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM event`;
  return row ? num(row.next) : 1;
}

/** LIMIT bound: TiDB rejects placeholders there — inline a safe integer. */
function safeLimit(limit: number): number {
  const n = Math.trunc(Number(limit));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 50;
}

export function createEventStore(): EventStore {
  return {
    async append(e: EventInput): Promise<EventRecord> {
      const inserted = await insert`
        INSERT INTO event (at, kind, worksite_id, payload_json)
        VALUES (${e.at}, ${e.kind}, ${e.worksiteId ?? ""}, ${e.payloadJson ?? ""})`;
      const seq = inserted > 0 ? inserted : await nextSeq();
      return { ...e, seq };
    },

    async listByWorksite(worksiteId: string, limit?: number): Promise<EventRecord[]> {
      // TiDB refuses bound parameters in LIMIT (ERROR 1210): inline a
      // sanitized integer; the WHERE value stays parameterized.
      const rows = limit
        ? await allText<EventRow>(
            `SELECT * FROM event WHERE worksite_id = ? ORDER BY seq DESC LIMIT ${safeLimit(limit)}`,
            [worksiteId],
          )
        : await all<EventRow>`
            SELECT * FROM event WHERE worksite_id = ${worksiteId} ORDER BY seq DESC`;
      return rows.map(toEvent);
    },

    async recent(limit?: number): Promise<EventRecord[]> {
      const rows = limit
        ? await allText<EventRow>(
            `SELECT * FROM event ORDER BY seq DESC LIMIT ${safeLimit(limit)}`,
            [],
          )
        : await all<EventRow>`SELECT * FROM event ORDER BY seq DESC`;
      return rows.map(toEvent);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Priority rules                                                      */
/* ------------------------------------------------------------------ */

interface RuleRow {
  project_id: string;
  order_json: string;
  agent_yields: number;
  hard_mode: number;
  dormancy_hours: number;
}

function toRules(row: RuleRow): PriorityRules {
  return {
    projectId: str(row.project_id),
    order: parseJson<PriorityCriterion[]>(row.order_json, DEFAULT_PRIORITY_RULES.order),
    agentYields: bool(row.agent_yields),
    hardMode: bool(row.hard_mode),
    dormancyHours: num(row.dormancy_hours),
  };
}

export function createRulesStore(): RulesStore {
  return {
    async get(projectId: string): Promise<PriorityRules> {
      const row = await one<RuleRow>`
        SELECT * FROM priority_rule WHERE project_id = ${projectId}`;
      if (!row) return { projectId, ...DEFAULT_PRIORITY_RULES };
      return toRules(row);
    },

    async set(rules: PriorityRules): Promise<PriorityRules> {
      await upsertByProject(rules);
      return rules;
    },
  };
}

/** Upsert on the project id (the primary key of `priority_rule`). */
async function upsertByProject(rules: PriorityRules): Promise<void> {
  await upsertByKey(
    "priority_rule",
    "project_id",
    rules.projectId,
    ["order_json", "agent_yields", "hard_mode", "dormancy_hours"],
    [
      json(rules.order),
      rules.agentYields ? 1 : 0,
      rules.hardMode ? 1 : 0,
      rules.dormancyHours,
    ],
  );
}
