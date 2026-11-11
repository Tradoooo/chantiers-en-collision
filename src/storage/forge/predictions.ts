/**
 * storage/forge/predictions — PredictionStore over Forge SQL.
 * Owner: workstream E.
 *
 * A prediction is stored as one row per predicted path (spec §18: the
 * `prediction` table holds `path` and `confidence`); the overall confidence
 * and the basis are repeated on every row of the same computation. `save`
 * replaces the rows of (issueKey, repoId); `findByIssue` returns the LATEST
 * computation per repo.
 */

import type { FootprintPrediction, PathKind, PredictedPath } from "../../core/types";
import type { PredictionStore } from "../interfaces";
import { allText, json, newId, num, parseJson, run, str } from "./db";
import type { SqlScalar } from "./db";

interface PredictionRow {
  id: string;
  issue_key: string;
  repo_id: string;
  path: string;
  kind: string;
  confidence: number;
  overall_confidence: number;
  basis_json: string;
  computed_at: string;
}

interface Basis {
  componentMatch: boolean;
  referenceTickets: string[];
}

function basisOf(row: PredictionRow): Basis {
  return parseJson<Basis>(row.basis_json, { componentMatch: false, referenceTickets: [] });
}

/** Rows of the latest computation of an issue, grouped by repo. */
function latestByRepo(rows: PredictionRow[]): Map<string, PredictionRow[]> {
  const newest = new Map<string, string>();
  rows.forEach((row) => {
    const repoId = str(row.repo_id);
    const computedAt = str(row.computed_at);
    const known = newest.get(repoId);
    if (known === undefined || computedAt > known) newest.set(repoId, computedAt);
  });
  const grouped = new Map<string, PredictionRow[]>();
  rows.forEach((row) => {
    const repoId = str(row.repo_id);
    if (newest.get(repoId) !== str(row.computed_at)) return;
    const bucket = grouped.get(repoId) ?? [];
    bucket.push(row);
    grouped.set(repoId, bucket);
  });
  return grouped;
}

function toPrediction(repoId: string, rows: PredictionRow[]): FootprintPrediction {
  const first = rows[0];
  const entries: PredictedPath[] = rows
    .filter((row) => str(row.path) !== "")
    .map((row) => ({
      path: str(row.path),
      kind: str(row.kind) as PathKind,
      confidence: num(row.confidence),
    }));
  return {
    issueKey: str(first.issue_key),
    repoId,
    entries,
    confidence: num(first.overall_confidence),
    basis: basisOf(first),
    computedAt: str(first.computed_at),
  };
}

export function createPredictionStore(): PredictionStore {
  return {
    async save(p: FootprintPrediction): Promise<FootprintPrediction> {
      await run`
        DELETE FROM prediction WHERE issue_key = ${p.issueKey} AND repo_id = ${p.repoId}`;
      const entries = p.entries.length > 0 ? p.entries : [{ path: "", kind: "file" as PathKind, confidence: 0 }];
      for (const entry of entries) {
        await run`
          INSERT INTO prediction
            (id, issue_key, repo_id, path, kind, confidence, overall_confidence, basis_json, computed_at)
          VALUES
            (${newId("prd")}, ${p.issueKey}, ${p.repoId}, ${entry.path}, ${entry.kind},
             ${entry.confidence}, ${p.confidence}, ${json(p.basis)}, ${p.computedAt})`;
      }
      return p;
    },

    async findByIssue(issueKey: string, repoId?: string): Promise<FootprintPrediction[]> {
      const text = repoId
        ? `SELECT * FROM prediction WHERE issue_key = ? AND repo_id = ? ORDER BY computed_at DESC`
        : `SELECT * FROM prediction WHERE issue_key = ? ORDER BY computed_at DESC`;
      const params: SqlScalar[] = repoId ? [issueKey, repoId] : [issueKey];
      const rows = await allText<PredictionRow>(text, params);
      const grouped = latestByRepo(rows);
      return Array.from(grouped.entries()).map(([repo, group]) => toPrediction(repo, group));
    },

    async removeByIssue(issueKey: string): Promise<number> {
      return run`DELETE FROM prediction WHERE issue_key = ${issueKey}`;
    },
  };
}
