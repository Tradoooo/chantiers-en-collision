/**
 * storage/memory/repos — RepoStore + ZoneStore.
 *
 * `ensure` is find-or-create on (projectId, normalized slug) and applies the
 * default zone catalog at CREATION only; `seedDefaults` is idempotent (a zone
 * whose name already exists in the repo is skipped, spec §6).
 */

import type { RepoRecord, Zone } from "../../core/types";
import { DEFAULT_ZONE_CATALOG } from "../../core/zones";
import type { RepoStore, ZoneStore } from "../interfaces";
import { clone } from "./clone";
import type { IdGen } from "./ids";
import type { MemoryData } from "./state";
import { normalizeSlug } from "./util";

function findZoneByName(data: MemoryData, repoId: string, name: string): Zone | undefined {
  for (const zone of data.zones.values()) {
    if (zone.repoId === repoId && zone.name === name) return zone;
  }
  return undefined;
}

function findRepoBySlug(data: MemoryData, projectId: string, slug: string): RepoRecord | undefined {
  for (const repo of data.repos.values()) {
    if (repo.projectId === projectId && repo.slug === slug) return repo;
  }
  return undefined;
}

export function createZoneStore(data: MemoryData, ids: IdGen): ZoneStore {
  const listByRepo = (repoId: string): Zone[] => {
    const out: Zone[] = [];
    for (const zone of data.zones.values()) {
      if (zone.repoId === repoId) out.push(clone(zone));
    }
    return out;
  };

  return {
    async upsert(zone: Zone): Promise<Zone> {
      const id = zone.id || ids("zone");
      const known = data.zones.get(id) ?? findZoneByName(data, zone.repoId, zone.name);
      const stored: Zone = { ...clone(zone), id: known ? known.id : id };
      data.zones.set(stored.id, stored);
      return clone(stored);
    },

    async findById(id: string): Promise<Zone | undefined> {
      const zone = data.zones.get(id);
      return zone ? clone(zone) : undefined;
    },

    async listByRepo(repoId: string): Promise<Zone[]> {
      return listByRepo(repoId);
    },

    async remove(id: string): Promise<boolean> {
      return data.zones.delete(id);
    },

    async seedDefaults(repoId: string): Promise<Zone[]> {
      for (const entry of DEFAULT_ZONE_CATALOG) {
        if (findZoneByName(data, repoId, entry.name)) continue; // idempotent
        const zone: Zone = {
          id: ids("zone"),
          repoId,
          name: entry.name,
          patterns: [...entry.patterns],
          nature: entry.nature,
        };
        data.zones.set(zone.id, zone);
      }
      return listByRepo(repoId);
    },
  };
}

export function createRepoStore(data: MemoryData, ids: IdGen, zones: ZoneStore): RepoStore {
  const store = (repo: RepoRecord): RepoRecord => {
    const stored = { ...clone(repo), slug: normalizeSlug(repo.slug) };
    data.repos.set(stored.id, stored);
    return stored;
  };

  return {
    async upsert(repo: RepoRecord): Promise<RepoRecord> {
      const id = repo.id || ids("repo");
      const known = data.repos.get(id) ?? findRepoBySlug(data, repo.projectId, normalizeSlug(repo.slug));
      return clone(store({ ...clone(repo), id: known ? known.id : id }));
    },

    async findById(id: string): Promise<RepoRecord | undefined> {
      const repo = data.repos.get(id);
      return repo ? clone(repo) : undefined;
    },

    async findBySlug(projectId: string, slug: string): Promise<RepoRecord | undefined> {
      const repo = findRepoBySlug(data, projectId, normalizeSlug(slug));
      return repo ? clone(repo) : undefined;
    },

    async listByProject(projectId: string): Promise<RepoRecord[]> {
      const out: RepoRecord[] = [];
      for (const repo of data.repos.values()) {
        if (repo.projectId === projectId) out.push(clone(repo));
      }
      return out;
    },

    async ensure(projectId: string, slug: string, defaultBranch?: string): Promise<RepoRecord> {
      const normalized = normalizeSlug(slug);
      const found = findRepoBySlug(data, projectId, normalized);
      if (found) return clone(found);
      const created = store({
        id: ids("repo"),
        projectId,
        provider: "other",
        slug: normalized,
        defaultBranch: defaultBranch ?? "main",
      });
      await zones.seedDefaults(created.id); // creation only
      return clone(created);
    },
  };
}
