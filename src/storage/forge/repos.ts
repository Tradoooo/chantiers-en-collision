/**
 * storage/forge/repos — RepoStore and ZoneStore over Forge SQL.
 * Owner: workstream E.
 *
 * Semantics (src/storage/interfaces.ts):
 *  - RepoStore.ensure is find-or-create on (projectId, slug) and applies the
 *    default zone catalog on create (spec §6).
 *  - ZoneStore.seedDefaults is idempotent: it only creates the catalog zones
 *    that the repo does not have yet, by (repoId, name). A team edit of a
 *    default zone is never overwritten.
 */

import { DEFAULT_ZONE_CATALOG } from "../../core/zones";
import type { RepoRecord, Zone, ZoneNature } from "../../core/types";
import type { RepoStore, ZoneStore } from "../interfaces";
import { all, json, newId, one, optStr, parseJson, run, str, upsert } from "./db";

interface RepoRow {
  id: string;
  project_id: string;
  provider: string;
  slug: string;
  default_branch: string;
}

interface ZoneRow {
  id: string;
  repo_id: string;
  name: string;
  patterns: string;
  nature: string;
  component_id: string;
  frozen_from: string;
  frozen_to: string;
}

function toRepo(row: RepoRow): RepoRecord {
  return {
    id: str(row.id),
    projectId: str(row.project_id),
    provider: str(row.provider) as RepoRecord["provider"],
    slug: str(row.slug),
    defaultBranch: str(row.default_branch),
  };
}

function toZone(row: ZoneRow): Zone {
  const zone: Zone = {
    id: str(row.id),
    repoId: str(row.repo_id),
    name: str(row.name),
    patterns: parseJson<string[]>(row.patterns, []),
    nature: str(row.nature) as ZoneNature,
  };
  const componentId = optStr(row.component_id);
  if (componentId) zone.componentId = componentId;
  const frozenFrom = optStr(row.frozen_from);
  if (frozenFrom) zone.frozenFrom = frozenFrom;
  const frozenTo = optStr(row.frozen_to);
  if (frozenTo) zone.frozenTo = frozenTo;
  return zone;
}

async function writeZone(zone: Zone): Promise<void> {
  await upsert(
    "zone",
    zone.id,
    [
      "repo_id",
      "name",
      "patterns",
      "nature",
      "component_id",
      "frozen_from",
      "frozen_to",
    ],
    [
      zone.repoId,
      zone.name,
      json(zone.patterns),
      zone.nature,
      zone.componentId ?? "",
      zone.frozenFrom ?? "",
      zone.frozenTo ?? "",
    ],
  );
}

async function writeRepo(repo: RepoRecord): Promise<void> {
  await upsert(
    "repo",
    repo.id,
    ["project_id", "provider", "slug", "default_branch"],
    [repo.projectId, repo.provider, repo.slug, repo.defaultBranch],
  );
}

/** Zones of a repo, ordered by name (stable for the UI and the catalog). */
export async function zonesOfRepo(repoId: string): Promise<Zone[]> {
  const rows = await all<ZoneRow>`
    SELECT * FROM zone WHERE repo_id = ${repoId} ORDER BY name`;
  return rows.map(toZone);
}

/** Options of the repo store: the catalog seeding lives in the zone store. */
export interface RepoStoreOptions {
  seedZones: (repoId: string) => Promise<void>;
}

export function createRepoStore(options: RepoStoreOptions): RepoStore {
  return {
    async upsert(repo: RepoRecord): Promise<RepoRecord> {
      await writeRepo(repo);
      return repo;
    },

    async findById(id: string): Promise<RepoRecord | undefined> {
      const row = await one<RepoRow>`SELECT * FROM repo WHERE id = ${id}`;
      return row ? toRepo(row) : undefined;
    },

    async findBySlug(projectId: string, slug: string): Promise<RepoRecord | undefined> {
      const row = await one<RepoRow>`
        SELECT * FROM repo WHERE project_id = ${projectId} AND slug = ${slug}`;
      return row ? toRepo(row) : undefined;
    },

    async listByProject(projectId: string): Promise<RepoRecord[]> {
      const rows = await all<RepoRow>`
        SELECT * FROM repo WHERE project_id = ${projectId} ORDER BY slug`;
      return rows.map(toRepo);
    },

    async ensure(projectId: string, slug: string, defaultBranch?: string): Promise<RepoRecord> {
      const existing = await this.findBySlug(projectId, slug);
      if (existing) return existing;
      const repo: RepoRecord = {
        id: newId("repo"),
        projectId,
        provider: "other",
        slug,
        defaultBranch: defaultBranch ?? "main",
      };
      await writeRepo(repo);
      await options.seedZones(repo.id);
      return repo;
    },
  };
}

export function createZoneStore(): ZoneStore {
  return {
    async upsert(zone: Zone): Promise<Zone> {
      await writeZone(zone);
      return zone;
    },

    async findById(id: string): Promise<Zone | undefined> {
      const row = await one<ZoneRow>`SELECT * FROM zone WHERE id = ${id}`;
      return row ? toZone(row) : undefined;
    },

    listByRepo(repoId: string): Promise<Zone[]> {
      return zonesOfRepo(repoId);
    },

    async remove(id: string): Promise<boolean> {
      const affected = await run`DELETE FROM zone WHERE id = ${id}`;
      return affected > 0;
    },

    async seedDefaults(repoId: string): Promise<Zone[]> {
      const existing = await zonesOfRepo(repoId);
      const names = new Set(existing.map((zone) => zone.name));
      for (const entry of DEFAULT_ZONE_CATALOG) {
        if (names.has(entry.name)) continue;
        const zone: Zone = {
          id: newId("zone"),
          repoId,
          name: entry.name,
          patterns: entry.patterns,
          nature: entry.nature,
        };
        await writeZone(zone);
      }
      return zonesOfRepo(repoId);
    },
  };
}