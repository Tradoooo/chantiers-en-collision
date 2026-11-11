/**
 * storage/memory/extras — the five remaining stores:
 * predictions, real conflicts, hook tokens, events and priority rules.
 */

import { DEFAULT_PRIORITY_RULES } from "../../core/types";
import type {
  EventInput,
  EventRecord,
  FootprintPrediction,
  HookToken,
  PriorityRules,
  RealConflict,
} from "../../core/types";
import type {
  ConflictStore,
  EventStore,
  PredictionStore,
  RulesStore,
  TokenStore,
} from "../interfaces";
import { clone } from "./clone";
import type { IdGen } from "./ids";
import type { MemoryData } from "./state";
import { nowIso } from "./util";

/** `recent()` / `listByWorksite()` without an explicit limit. */
const DEFAULT_EVENT_LIMIT = 50;

function predictionKey(issueKey: string, repoId: string): string {
  return `${issueKey}\u0000${repoId}`;
}

export function createPredictionStore(data: MemoryData): PredictionStore {
  return {
    /** Saving replaces the predictions of the same (issueKey, repoId). */
    async save(p: FootprintPrediction): Promise<FootprintPrediction> {
      const stored = clone(p);
      data.predictions.set(predictionKey(p.issueKey, p.repoId), stored);
      return clone(stored);
    },

    async findByIssue(issueKey: string, repoId?: string): Promise<FootprintPrediction[]> {
      const out: FootprintPrediction[] = [];
      for (const p of data.predictions.values()) {
        if (p.issueKey !== issueKey) continue;
        if (repoId !== undefined && p.repoId !== repoId) continue;
        out.push(clone(p));
      }
      return out.sort((a, b) => b.computedAt.localeCompare(a.computedAt));
    },

    async removeByIssue(issueKey: string): Promise<number> {
      let removed = 0;
      for (const [key, p] of [...data.predictions.entries()]) {
        if (p.issueKey !== issueKey) continue;
        data.predictions.delete(key);
        removed += 1;
      }
      return removed;
    },
  };
}

export function createConflictStore(data: MemoryData, ids: IdGen): ConflictStore {
  return {
    async report(c: Omit<RealConflict, "id"> & { id?: string }): Promise<RealConflict> {
      const stored: RealConflict = { ...clone(c), id: c.id || ids("cfl") };
      data.conflicts.set(stored.id, stored);
      return clone(stored);
    },

    async list(repoId?: string, since?: string): Promise<RealConflict[]> {
      const out: RealConflict[] = [];
      for (const c of data.conflicts.values()) {
        if (repoId !== undefined && c.repoId !== repoId) continue;
        if (since !== undefined && c.reportedAt < since) continue;
        out.push(clone(c));
      }
      return out.sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
    },
  };
}

export function createTokenStore(data: MemoryData): TokenStore {
  return {
    async create(t: Omit<HookToken, "createdAt"> & { createdAt?: string }): Promise<HookToken> {
      const stored: HookToken = { ...clone(t), createdAt: t.createdAt ?? nowIso() };
      data.tokens.set(stored.tokenHash, stored);
      return clone(stored);
    },

    async findByHash(tokenHash: string): Promise<HookToken | undefined> {
      const token = data.tokens.get(tokenHash);
      return token ? clone(token) : undefined;
    },

    async touchLastUsed(tokenHash: string, at: string): Promise<void> {
      const token = data.tokens.get(tokenHash);
      if (!token) return;
      data.tokens.set(tokenHash, { ...token, lastUsedAt: at });
    },

    async listByAccount(accountId: string): Promise<HookToken[]> {
      const out: HookToken[] = [];
      for (const token of data.tokens.values()) {
        if (token.accountId === accountId) out.push(clone(token));
      }
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async revoke(tokenHash: string): Promise<boolean> {
      return data.tokens.delete(tokenHash);
    },
  };
}

export function createEventStore(data: MemoryData): EventStore {
  /** Newest first, limited (the seq counter makes the order total). */
  const latest = (keep: (e: EventRecord) => boolean, limit?: number): EventRecord[] =>
    data.events
      .filter(keep)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit ?? DEFAULT_EVENT_LIMIT)
      .map((e) => clone(e));

  return {
    async append(e: EventInput): Promise<EventRecord> {
      const stored: EventRecord = { ...clone(e), seq: data.events.length + 1 };
      data.events.push(stored);
      return clone(stored);
    },

    async listByWorksite(worksiteId: string, limit?: number): Promise<EventRecord[]> {
      return latest((e) => e.worksiteId === worksiteId, limit);
    },

    async recent(limit?: number): Promise<EventRecord[]> {
      return latest(() => true, limit);
    },
  };
}

export function createRulesStore(data: MemoryData): RulesStore {
  return {
    async get(projectId: string): Promise<PriorityRules> {
      const stored = data.rules.get(projectId);
      if (stored) return clone(stored);
      return { ...clone(DEFAULT_PRIORITY_RULES), projectId };
    },

    async set(rules: PriorityRules): Promise<PriorityRules> {
      const stored = clone(rules);
      data.rules.set(stored.projectId, stored);
      return clone(stored);
    },
  };
}
