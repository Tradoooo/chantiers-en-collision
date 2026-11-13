# SCHEMA — the 14 tables of the deployment, on one page

> Source of truth: [`src/storage/schema.ts`](../src/storage/schema.ts) (`SCHEMA_SQL`).
> This page is the readable map of the **14** tables and their indexes; if the two
> ever disagree, the code wins — fix this page.
>
> Forge SQL ground rules (spec §19): **no foreign keys**, idempotent DDL
> (`CREATE … IF NOT EXISTS`), `VARCHAR(255)` for keys/indexed columns (a
> MySQL-family engine refuses a `TEXT` primary key without a prefix length),
> JSON payloads in `TEXT`, optional strings stored as `''`. Every statement is
> applied once through `migrationRunner` (an `__migrations` table records it), so
> `ensureSchema()` is safe on every cold start.

| # | Table | Role | Key columns · indexes |
|---|---|---|---|
| 1 | `repo` | a repository registered for a Jira project | PK `id`; `project_id, provider, slug, default_branch`; idx `(project_id, slug)` |
| 2 | `zone` | a named part of a repo with a behaviour (nature, freeze window) | PK `id`; `repo_id, name, patterns, nature, component_id, frozen_from, frozen_to`; idx `(repo_id, name)` |
| 3 | `actor_session` | who is working (person or agent, machine) | PK `id`; `account_id, kind, client, session_ref, agent_ref, parent_session_id, first_seen, last_seen`; idx `(account_id, session_ref, agent_ref)` |
| 4 | `worksite` | one work in progress on a ticket, its state, its PR | PK `id`; `issue_key, issue_id, repo_id, session_id, account_id, state, branch, opened_at, last_activity_at, closed_at, ticket`; idx `(repo_id, state)`, `(issue_key, repo_id, state)`, `(session_id, state)` |
| 5 | `footprint` | one **path** an emprise covers (repo_id denormalised so the overlap search needs no join) | PK `id`; `worksite_id, repo_id, path, kind, source, mode, first_at, last_at`; idx `(repo_id, path)`, `(worksite_id)`, `(worksite_id, path)` |
| 6 | `collision` | an overlap between two worksites, its degree, its state | PK `id`; `repo_id, worksite_a, worksite_b, zone_id, path, degree, raw_degree, phase, state, resolution, resolved_by`; idx `(repo_id, state)`, `(repo_id, worksite_a, worksite_b)`, `(worksite_a, state)`, `(worksite_b, state)` |
| 7 | `reservation` | a reserved/frozen zone held by a worksite until it expires | PK `id`; `worksite_id, repo_id, patterns, hard, reason, created_at, expires_at, released_at`; idx `(repo_id, expires_at)`, `(worksite_id)` |
| 8 | `notice` | a message a worksite posts to its neighbours | PK `id`; `worksite_id, repo_id, author_account_id, issue_key, paths, text, created_at`; idx `(worksite_id, created_at)` |
| 9 | `notice_recipient` | per-recipient delivery of a notice | PK `id`; `notice_id, worksite_id, delivered_at`; idx `(worksite_id, delivered_at)`, `(notice_id, worksite_id)` |
| 10 | `prediction` | predicted paths of a ticket, with confidence and basis | PK `id`; `issue_key, repo_id, path, kind, confidence, overall_confidence, basis_json, computed_at`; idx `(issue_key, repo_id)` |
| 11 | `real_conflict` | a real merge conflict observed later — feeds the learning loop | PK `id`; `repo_id, worksite_a, worksite_b, issue_key_a, issue_key_b, paths, was_detected, reported_at`; idx `(repo_id, reported_at)` |
| 12 | `priority_rule` | per-project ordering of agents, yield/hard mode, dormancy | PK `project_id`; `order_json, agent_yields, hard_mode, dormancy_hours` |
| 13 | `hook_token` | a hashed Bearer token for the hook / MCP clients | PK `id`; `account_id, token_hash, scope, project_id, created_at, last_used_at`; idx `(token_hash)`, `(account_id)` |
| 14 | `event` | the append-only journal (audit, diagnostics) | PK `seq` (auto-increment); `at, kind, worksite_id, payload_json`; idx `(worksite_id)` |

## Two UNIQUE indexes deferred on purpose

Both business keys are enforced **by the code** today (memory store keyed, Forge
SELECT-then-write, and `scripts/check-storage.mjs` keeps the two stores honest).
The database `UNIQUE` index waits:

- **`footprint (worksite_id, path)`** — one row per path per worksite. A `UNIQUE`
  index on a table that already holds live rows fails if a single duplicate exists,
  so it waits for the duplicate check on the production table.
- **`collision (repo_id, worksite_a, worksite_b, zone_id)`** — one collision per
  pair+zone. A `UNIQUE` on those four `VARCHAR(255)` columns would exceed TiDB's
  3072-byte index limit (4 × 255 × utf8mb4 = 4080 B); it waits until the id columns
  are shortened.