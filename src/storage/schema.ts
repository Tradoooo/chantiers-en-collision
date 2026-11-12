/**
 * storage/schema — Forge SQL DDL (spec §18).
 * Owner: workstream E.
 *
 * Forge SQL constraints (spec §19): NO foreign keys, 1 GiB per installation,
 * 5 s per SELECT. Everything here is idempotent (IF NOT EXISTS) so
 * `ensureSchema()` can run on every cold start.
 *
 * Conventions:
 *  - snake_case columns; TEXT for strings, INTEGER for ints/booleans (0/1),
 *    REAL for numbers, TEXT ISO-8601 for timestamps;
 *  - JSON payloads serialized into TEXT columns (patterns, ticket, order_json,
 *    basis_json, payload_json, paths);
 *  - optional strings are stored as '' (empty) and mapped back to undefined;
 *  - keys/indexed columns are VARCHAR(255) instead of TEXT: a MySQL-family
 *    engine refuses a TEXT primary key or index without a prefix length;
 *  - `event.seq` and `priority_rule.project_id` are the explicit keys of
 *    their tables (no `id` column needed there).
 *
 * Import note: "@forge/sql" is imported lazily inside `ensureSchema()` so that
 * this module (and its pure, static test) stays loadable outside a Forge
 * runtime.
 */

/** One CREATE TABLE / CREATE INDEX statement per entry, idempotent (IF NOT EXISTS). */
export const SCHEMA_SQL: string[] = [
  /* ---------------------------- repo ---------------------------- */
  `CREATE TABLE IF NOT EXISTS repo (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    default_branch VARCHAR(255) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_repo_project_slug ON repo (project_id, slug)`,

  /* ---------------------------- zone ---------------------------- */
  `CREATE TABLE IF NOT EXISTS zone (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    repo_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    patterns TEXT NOT NULL,
    nature VARCHAR(32) NOT NULL,
    component_id VARCHAR(255) NOT NULL,
    frozen_from VARCHAR(40) NOT NULL,
    frozen_to VARCHAR(40) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_zone_repo_name ON zone (repo_id, name)`,

  /* ------------------------ actor_session ------------------------ */
  `CREATE TABLE IF NOT EXISTS actor_session (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    account_id VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    client VARCHAR(64) NOT NULL,
    session_ref VARCHAR(255) NOT NULL,
    agent_ref VARCHAR(255) NOT NULL,
    parent_session_id VARCHAR(255) NOT NULL,
    first_seen VARCHAR(40) NOT NULL,
    last_seen VARCHAR(40) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_ref ON actor_session (account_id, session_ref, agent_ref)`,

  /* --------------------------- worksite --------------------------- */
  `CREATE TABLE IF NOT EXISTS worksite (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    issue_key VARCHAR(64) NOT NULL,
    issue_id VARCHAR(64) NOT NULL,
    repo_id VARCHAR(255) NOT NULL,
    session_id VARCHAR(255) NOT NULL,
    account_id VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    branch VARCHAR(255) NOT NULL,
    state VARCHAR(16) NOT NULL,
    pr_open INTEGER NOT NULL DEFAULT 0,
    pr_approved INTEGER NOT NULL DEFAULT 0,
    opened_at VARCHAR(40) NOT NULL,
    last_activity_at VARCHAR(40) NOT NULL,
    closed_at VARCHAR(40) NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    ticket TEXT NOT NULL,
    parent_worksite_id VARCHAR(255) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_worksite_repo_state ON worksite (repo_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_worksite_issue ON worksite (issue_key, repo_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_worksite_session ON worksite (session_id, state)`,

  /* --------------------------- footprint --------------------------- */
  // repo_id is denormalized from the worksite so the overlap search can be
  // served by the (repo_id, path) index without a join (spec §18).
  `CREATE TABLE IF NOT EXISTS footprint (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    worksite_id VARCHAR(255) NOT NULL,
    repo_id VARCHAR(255) NOT NULL,
    path VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    source VARCHAR(16) NOT NULL,
    mode VARCHAR(16) NOT NULL,
    first_at VARCHAR(40) NOT NULL,
    last_at VARCHAR(40) NOT NULL,
    declared_mismatch INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_footprint_repo_path ON footprint (repo_id, path)`,
  `CREATE INDEX IF NOT EXISTS idx_footprint_worksite ON footprint (worksite_id)`,
  // The business key of a footprint is (worksite_id, path) — one row per
  // path per worksite. The code enforces it (SELECT then INSERT/UPDATE, and
  // the memory store keys by it). A UNIQUE index would enforce it in the
  // database too, but adding it to a table that already holds live rows
  // fails if a single duplicate exists — so it waits for the duplicate
  // check on the live table (scripts/check-storage.mjs keeps the contract
  // in the meantime).
  `CREATE INDEX IF NOT EXISTS idx_footprint_worksite_path ON footprint (worksite_id, path)`,

  /* --------------------------- collision --------------------------- */
  `CREATE TABLE IF NOT EXISTS collision (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    repo_id VARCHAR(255) NOT NULL,
    worksite_a VARCHAR(255) NOT NULL,
    worksite_b VARCHAR(255) NOT NULL,
    zone_id VARCHAR(255) NOT NULL,
    path VARCHAR(255) NOT NULL,
    degree INTEGER NOT NULL,
    raw_degree INTEGER NOT NULL,
    phase VARCHAR(16) NOT NULL,
    state VARCHAR(16) NOT NULL,
    resolution VARCHAR(16) NOT NULL,
    resolved_by VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    detected_at VARCHAR(40) NOT NULL,
    probable INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_collision_repo_state ON collision (repo_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_collision_pair ON collision (repo_id, worksite_a, worksite_b)`,
  `CREATE INDEX IF NOT EXISTS idx_collision_worksite_a ON collision (worksite_a, state)`,
  `CREATE INDEX IF NOT EXISTS idx_collision_worksite_b ON collision (worksite_b, state)`,
  // NOTE: the contract "one collision per (repo, worksite_a, worksite_b, zone)"
  // is enforced by the code (memory store keyed, forge upsert by key). A
  // UNIQUE index on those 4 columns would exceed the TiDB 3072-byte index
  // limit (4 × VARCHAR(255) × utf8mb4 = 4080 B) — deferred until the id
  // columns are shortened. The parity guard (scripts/check-storage.mjs) keeps
  // the two stores honest in the meantime.

  /* -------------------------- reservation -------------------------- */
  `CREATE TABLE IF NOT EXISTS reservation (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    worksite_id VARCHAR(255) NOT NULL,
    repo_id VARCHAR(255) NOT NULL,
    patterns TEXT NOT NULL,
    hard INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    expires_at VARCHAR(40) NOT NULL,
    released_at VARCHAR(40) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reservation_repo ON reservation (repo_id, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_reservation_worksite ON reservation (worksite_id)`,

  /* ---------------------------- notice ---------------------------- */
  `CREATE TABLE IF NOT EXISTS notice (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    worksite_id VARCHAR(255) NOT NULL,
    repo_id VARCHAR(255) NOT NULL,
    author_account_id VARCHAR(255) NOT NULL,
    issue_key VARCHAR(64) NOT NULL,
    paths TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notice_worksite ON notice (worksite_id, created_at)`,

  /* ------------------------ notice_recipient ------------------------ */
  `CREATE TABLE IF NOT EXISTS notice_recipient (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    notice_id VARCHAR(255) NOT NULL,
    worksite_id VARCHAR(255) NOT NULL,
    delivered_at VARCHAR(40) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notice_recipient_worksite ON notice_recipient (worksite_id, delivered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notice_recipient_notice ON notice_recipient (notice_id, worksite_id)`,

  /* --------------------------- prediction --------------------------- */
  // One row per predicted path; the overall confidence and the basis are
  // repeated on every row of the same (issue_key, repo_id, computed_at).
  `CREATE TABLE IF NOT EXISTS prediction (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    issue_key VARCHAR(64) NOT NULL,
    repo_id VARCHAR(255) NOT NULL,
    path VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    confidence REAL NOT NULL,
    overall_confidence REAL NOT NULL,
    basis_json TEXT NOT NULL,
    computed_at VARCHAR(40) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prediction_issue ON prediction (issue_key, repo_id)`,

  /* ------------------------- real_conflict ------------------------- */
  `CREATE TABLE IF NOT EXISTS real_conflict (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    repo_id VARCHAR(255) NOT NULL,
    worksite_a VARCHAR(255) NOT NULL,
    worksite_b VARCHAR(255) NOT NULL,
    issue_key_a VARCHAR(64) NOT NULL,
    issue_key_b VARCHAR(64) NOT NULL,
    paths TEXT NOT NULL,
    was_detected INTEGER NOT NULL DEFAULT 0,
    reported_at VARCHAR(40) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_real_conflict_repo ON real_conflict (repo_id, reported_at)`,

  /* -------------------------- priority_rule -------------------------- */
  `CREATE TABLE IF NOT EXISTS priority_rule (
    project_id VARCHAR(255) NOT NULL PRIMARY KEY,
    order_json TEXT NOT NULL,
    agent_yields INTEGER NOT NULL DEFAULT 1,
    hard_mode INTEGER NOT NULL DEFAULT 0,
    dormancy_hours INTEGER NOT NULL DEFAULT 24
  )`,

  /* --------------------------- hook_token --------------------------- */
  `CREATE TABLE IF NOT EXISTS hook_token (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    account_id VARCHAR(255) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    scope VARCHAR(16) NOT NULL,
    project_id VARCHAR(255) NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    last_used_at VARCHAR(40) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_hook_token_hash ON hook_token (token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_hook_token_account ON hook_token (account_id)`,

  /* ----------------------------- event ----------------------------- */
  `CREATE TABLE IF NOT EXISTS event (
    seq INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    at VARCHAR(40) NOT NULL,
    kind VARCHAR(64) NOT NULL,
    worksite_id VARCHAR(255) NOT NULL,
    payload_json TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_event_worksite ON event (worksite_id)`,
];

/** Stable migration name for a statement, so re-running never re-applies it. */
function migrationName(statement: string): string {
  const match = /CREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)/i.exec(statement);
  if (!match) return `schema_${String(statement.length)}`;
  return `${match[1].toLowerCase()}_${match[2].toLowerCase()}`;
}

/**
 * Execute SCHEMA_SQL through Forge SQL (`migrationRunner`, which records each
 * statement in its own `__migrations` table and skips the already-applied
 * ones). Safe to call on every cold start: the DDL is idempotent anyway.
 */
export async function ensureSchema(): Promise<void> {
  const { migrationRunner } = await import("@forge/sql");
  SCHEMA_SQL.forEach((statement) => {
    migrationRunner.enqueue(migrationName(statement), statement);
  });
  await migrationRunner.run();
}