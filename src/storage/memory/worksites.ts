/**
 * storage/memory/worksites — WorksiteStore.
 *
 * "Open-ish" everywhere below means `state !== "closed"`: the store does not
 * filter dormant worksites out of the open listings (services decide), except
 * for `listIdleBefore`, which must not re-dormant an already dormant one.
 */

import type { Worksite } from "../../core/types";
import type { WorksiteStore } from "../interfaces";
import { clone } from "./clone";
import type { IdGen } from "./ids";
import type { MemoryData } from "./state";

const isOpen = (w: Worksite): boolean => w.state !== "closed";
/** Oldest first (chronological). */
const byOpened = (a: Worksite, b: Worksite): number =>
  a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id);
/** Newest first. */
const byOpenedDesc = (a: Worksite, b: Worksite): number => byOpened(b, a);

function pick(data: MemoryData, keep: (w: Worksite) => boolean): Worksite[] {
  const out: Worksite[] = [];
  for (const w of data.worksites.values()) {
    if (keep(w)) out.push(clone(w));
  }
  return out;
}

export function createWorksiteStore(data: MemoryData, ids: IdGen): WorksiteStore {
  return {
    async create(w: Omit<Worksite, "id"> & { id?: string }): Promise<Worksite> {
      const stored: Worksite = { ...clone(w), id: w.id || ids("ws") };
      data.worksites.set(stored.id, stored);
      return clone(stored);
    },

    async update(id: string, patch: Partial<Worksite>): Promise<Worksite | undefined> {
      const known = data.worksites.get(id);
      if (!known) return undefined;
      const stored: Worksite = { ...known, ...clone(patch), id };
      data.worksites.set(id, stored);
      return clone(stored);
    },

    async findById(id: string): Promise<Worksite | undefined> {
      const w = data.worksites.get(id);
      return w ? clone(w) : undefined;
    },

    async findBySession(sessionId: string): Promise<Worksite | undefined> {
      const matches = pick(data, (w) => w.sessionId === sessionId && isOpen(w));
      matches.sort(byOpenedDesc);
      return matches[0];
    },

    async findByIssue(
      issueKey: string,
      repoId?: string,
      sessionId?: string,
    ): Promise<Worksite[]> {
      const matches = pick(
        data,
        (w) =>
          w.issueKey === issueKey &&
          isOpen(w) &&
          (repoId === undefined || w.repoId === repoId) &&
          (sessionId === undefined || w.sessionId === sessionId),
      );
      return matches.sort(byOpenedDesc);
    },

    async listOpenByRepo(repoId: string): Promise<Worksite[]> {
      return pick(data, (w) => w.repoId === repoId && isOpen(w)).sort(byOpened);
    },

    async listByAccount(accountId: string): Promise<Worksite[]> {
      return pick(data, (w) => w.accountId === accountId).sort(byOpened);
    },

    async listIdleBefore(before: string): Promise<Worksite[]> {
      return pick(
        data,
        (w) => isOpen(w) && w.state !== "dormant" && w.lastActivityAt < before,
      ).sort(byOpened);
    },

    async listDormantBefore(before: string): Promise<Worksite[]> {
      return pick(data, (w) => w.state === "dormant" && w.lastActivityAt < before).sort(byOpened);
    },
  };
}
