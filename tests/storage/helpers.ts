/**
 * Shared fixtures for the in-memory store tests (split from memory.test.ts
 * for the <500-lines rule).
 */
import { classifyPath } from "../../src/core/paths";
import type {
  CollisionDraft,
  FootprintEntryInput,
  RepoRecord,
  Worksite,
} from "../../src/core/types";
import { createMemoryStores } from "../../src/storage/memory";
import { plusMinutes } from "../../src/testing/clock";

export const T0 = "2026-11-11T09:00:00.000Z";
export const at = (minutes: number): string => plusMinutes(T0, minutes);

export type Stores = ReturnType<typeof createMemoryStores>;

let counter = 0;

export async function makeRepo(stores: Stores, slug = "acme/billing"): Promise<RepoRecord> {
  return stores.repos.ensure("PROJ", slug);
}

export async function makeWorksite(
  stores: Stores,
  repo: RepoRecord,
  over: Partial<Worksite> = {},
): Promise<Worksite> {
  counter += 1;
  return stores.worksites.create({
    issueKey: `PROJ-${counter}`,
    repoId: repo.id,
    accountId: "lea@example.com",
    kind: "human",
    state: "open",
    openedAt: T0,
    lastActivityAt: T0,
    ...over,
  });
}

export async function addFootprint(
  stores: Stores,
  w: Worksite,
  path: string,
  over: Partial<FootprintEntryInput> = {},
): Promise<void> {
  await stores.footprints.add([
    {
      worksiteId: w.id,
      path,
      kind: classifyPath(path),
      source: "declared",
      mode: "edit",
      at: T0,
      ...over,
    },
  ]);
}

export function draft(over: Partial<CollisionDraft> = {}): CollisionDraft {
  return {
    repoId: "repo-1",
    worksiteA: "ws-1",
    worksiteB: "ws-2",
    path: "src/app.ts",
    degree: 2,
    rawDegree: 2,
    phase: "live",
    ...over,
  };
}

