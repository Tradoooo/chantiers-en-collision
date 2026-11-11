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

async function createWorksite(
  data: MemoryData,
  ids: IdGen,
  w: Omit<Worksite, "id"> & { id?: string },
): Promise<Worksite> {
  const stored: Worksite = { ...clone(w), id: w.id || ids("ws") };
  data.worksites.set(stored.id, stored);
  return clone(stored);
}

async function updateWorksite(
  data: MemoryData,
  id: string,
  patch: Partial<Worksite>,
): Promise<Worksite | undefined> {
  const known = data.worksites.get(id);
  if (!known) return undefined;
  const stored: Worksite = { ...known, ...clone(patch), id };
  data.worksites.set(id, stored);
  return clone(stored);
}

async function findWorksiteById(data: MemoryData, id: string): Promise<Worksite | undefined> {
  const w = data.worksites.get(id);
  return w ? clone(w) : undefined;
}

async function findWorksiteBySession(
  data: MemoryData,
  sessionId: string,
): Promise<Worksite | undefined> {
  const matches = pick(data, (w) => w.sessionId === sessionId && isOpen(w));
  matches.sort(byOpenedDesc);
  return matches[0];
}

async function findWorksitesByIssue(
  data: MemoryData,
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
}

async function listOpenWorksitesByRepo(data: MemoryData, repoId: string): Promise<Worksite[]> {
  return pick(data, (w) => w.repoId === repoId && isOpen(w)).sort(byOpened);
}

async function listWorksitesByAccount(data: MemoryData, accountId: string): Promise<Worksite[]> {
  return pick(data, (w) => w.accountId === accountId).sort(byOpened);
}

async function listIdleWorksitesBefore(data: MemoryData, before: string): Promise<Worksite[]> {
  return pick(
    data,
    (w) => isOpen(w) && w.state !== "dormant" && w.lastActivityAt < before,
  ).sort(byOpened);
}

async function listDormantWorksitesBefore(data: MemoryData, before: string): Promise<Worksite[]> {
  return pick(data, (w) => w.state === "dormant" && w.lastActivityAt < before).sort(byOpened);
}

export function createWorksiteStore(data: MemoryData, ids: IdGen): WorksiteStore {
  return {
    create: (w) => createWorksite(data, ids, w),
    update: (id, patch) => updateWorksite(data, id, patch),
    findById: (id) => findWorksiteById(data, id),
    findBySession: (sessionId) => findWorksiteBySession(data, sessionId),
    findByIssue: (issueKey, repoId, sessionId) =>
      findWorksitesByIssue(data, issueKey, repoId, sessionId),
    listOpenByRepo: (repoId) => listOpenWorksitesByRepo(data, repoId),
    listByAccount: (accountId) => listWorksitesByAccount(data, accountId),
    listIdleBefore: (before) => listIdleWorksitesBefore(data, before),
    listDormantBefore: (before) => listDormantWorksitesBefore(data, before),
    listMerged: (repoId, since) => listMergedWorksites(data, repoId, since),
  };
}

/** Closed worksites with outcome "merged" (prediction accuracy, spec §13). */
async function listMergedWorksites(
  data: MemoryData,
  repoId?: string,
  since?: string,
): Promise<Worksite[]> {
  return pick(
    data,
    (w) =>
      w.state === "closed" &&
      w.outcome === "merged" &&
      (repoId === undefined || w.repoId === repoId) &&
      (since === undefined || (w.closedAt ?? w.lastActivityAt) >= since),
  );
}
