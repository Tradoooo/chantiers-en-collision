/**
 * storage/schema — Forge SQL DDL (spec §18).
 * Owner: workstream E. Replace the stubs; keep signatures EXACTLY.
 *
 * Forge SQL constraints: NO foreign keys, 1 GiB per installation, 5 s per
 * SELECT. Import the tagged template from "@forge/sql" (NOT @forge/api):
 *   import { sql, migrationRunner } from "@forge/sql";
 * Tables (spec §18): repo, zone, actor_session, worksite, footprint,
 * collision, reservation, notice, notice_recipient, prediction, real_conflict,
 * priority_rule, hook_token, event.
 * Index: footprint (repo_id, path) — the overlap search relies on it.
 */

/** One CREATE TABLE / CREATE INDEX statement per entry, idempotent (IF NOT EXISTS). */
export const SCHEMA_SQL: string[] = [
  // TODO(schema): fill with the 14 tables + indexes
];

/**
 * Execute SCHEMA_SQL through Forge SQL (`import { sql } from "@forge/sql"`).
 * Safe to call on every cold start (IF NOT EXISTS everywhere). Prefer
 * `migrationRunner` when batching the DDL.
 */
export async function ensureSchema(): Promise<void> {
  throw new Error("TODO(schema): not implemented — see docs/CONTRACTS.md");
}
