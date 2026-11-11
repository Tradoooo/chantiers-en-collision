# Architecture

Chantiers en collision is **one Forge app installed on Jira**, with an optional Bitbucket
companion app in lot S (a Jira-installed Forge app cannot call the Bitbucket API — spec §19).

Four entry points, one data model:

```
  agent (Rovo MCP)      agent client (hook)        CI (push)          human (Jira UI)
        │                      │                       │                     │
   13 MCP tools          web trigger `ingest`     web trigger `ingest`   Forge UI screens
        │              /open /touch /close        /ci/footprint          panels, map, sprint,
        │                                        /ci/conflict            settings, gadget
        └───────────────┬───────────────────────────┴─────────────────────────┘
                        ▼
                  src/services/*        (declare, worksites, notices, reservations,
                        │                resolve, planning, ingest, maintenance, tokens)
                        ▼
                   src/core/*           (paths, zones, degrees, collisions, verdict,
                        │                footprints, lifecycle, predict, priority, waves)
                        ▼
              src/storage/*             (Forge SQL — 14 tables, no foreign keys)
                        ▲
        scheduledTrigger│  fiveMinute (dormancy, expiry) · day (predictions, learning)
             trigger    │  avi:jira:created:issue · avi:jira:updated:issue
```

## Modules (manifest.yml)

| Module | Entries | Notes |
|---|---|---|
| `rovo:mcp` | one server `chantiers-mcp`, 13 tools | Preview; ≤ 50 tools; external access over OAuth 2.1 after an admin enables it. |
| `action` | 13, one per tool | Inputs are simple values only; 55 s budget. Automation-triggered agents may only call `GET` actions — hence all planning tools are `GET`. |
| `webtrigger` | `ingest`, `urlFormat: v2`, `response: { type: dynamic }` | Dynamic response so the hook JSON can be returned. |
| `jira:issuePanel` | `worksite-panel` | Footprint by source, neighbours, collisions and their ways out, notices. |
| `jira:projectPage` | `worksite-map` | Coloured tree of the repository + collision graph + proposed waves. |
| `jira:sprintAction` | `sprint-check` | Matrix of the sprint's tickets, hinges, advised order. |
| `jira:projectSettingsPage` | `project-settings` | Repositories, zones, yield order, durations, hard mode, downloadable hook file and CI step. |
| `jira:personalSettingsPage` | `personal-settings` | Personal token, my worksites, my agent sessions. |
| `jira:dashboardGadget` | `collision-stats` | The four numbers of spec §13. |
| `jira:customField` | `collisions-field` | Open collision count + worst degree (lot S). |
| `jira:jqlFunction` | `collidingWork`, `collidesWith` | `issue in collidingWork()`, `issue in collidesWith("PROJ-88")`. |
| `trigger` | `issue-events` | `avi:jira:created:issue`, `avi:jira:updated:issue`. |
| `scheduledTrigger` | `five-minute-sweep`, `daily-jobs` | ≤ 5 per app, ≤ 900 s per run. |
| `rovo:agent` | `site-foreman` | Prompt: `prompts/site-foreman.md`, 6 read-only actions. |
| `rovo:skill` | `avoid-collisions` | Prompt: `prompts/avoid-collisions.md`; same content as `templates/skill/SKILL.md`. |
| `function` | 20 | Every handler referenced above, all in `src/index.ts`. |

## Step by step: what happens on a declaration (spec §17)

1. **Entry.** The call arrives over MCP, from the hook, or from CI. **The account comes from the
   call context or from the token — never from an input.** A `session` input distinguishes
   sessions; it grants no right.
2. **Normalisation.** The repository slug is resolved to a `repo.id`; paths are reduced to
   repo-relative paths (no leading `./` or `/`), classified as file / folder / pattern.
3. **Footprint update.** The worksite's footprint is upserted, **each entry keeping its source**
   (`declared`, `observed`, `attested`, `predicted`) and its mode (`edit`, `create`, `delete`,
   `rename`).
4. **Overlap search.** The app looks for non-closed worksites **in the same repository** whose
   footprint entry is equal to, contains, or is contained in the new entry. For a file: its exact
   path and every parent directory. For a folder: everything starting with it. Patterns go through
   `entriesOverlap`.
5. **Degree + collision.** The degree is computed from the zone nature and the neighbour's state;
   modulations apply (hotspot, dormancy, prediction-only cap). The collision row is created or
   updated — **one collision per (pair of worksites, zone)**, keeping the first `detectedAt`.
6. **Response.** The verdict leaves with the pending notices (delivered **once per session**, and
   only when the response actually goes out). The event is journalled, and the ticket's custom
   field is refreshed.

## Footprint: four sources (spec §5)

| Source | Where it comes from | When | What it is worth |
|---|---|---|---|
| **predicted** | ticket component, similar merged tickets, ticket text | at creation, i.e. while planning | a probability, never blocking (capped at D1, tagged `probable`) |
| **declared** | `declare-footprint`, or the issue panel | when the work starts | an intention |
| **observed** | agent-client hook: every file the agent is about to edit | during the work, live | a fact, obtained **without** the agent's cooperation |
| **attested** | branch file list sent by CI (or by the Bitbucket companion app) | at push | a fact, valid for humans too |

Each source covers the blind spot of the others: a developer who declares nothing and installs
nothing becomes visible at push (attested); an agent that ignores the tool is still seen by the
hook (observed); a ticket nobody started already has a probable footprint (predicted).

**The fact beats the intent.** If an agent edits a file outside what it declared, the footprint
widens, detection is replayed, and the gap is noted on the entry (`declaredMismatch`). The panel
shows what is supposed, announced and proven — per entry, not as one blurred blob.

## Zones and natures (spec §6)

A zone gives a name and a behaviour to a part of the repository. Most specific patterns win; an
out-of-scope match makes the path ignored entirely.

| Nature | Behaviour | Default catalogue |
|---|---|---|
| `ordinary` | the collision depends on the file | everything else |
| `exclusive` | one worksite at a time | `**/migrations/**`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `go.sum`, `schema.prisma`, `openapi*.y*ml` |
| `hotspot` | overlap expected, degree lowered one notch | `**/routes.*`, `**/locales/**`, `**/i18n/**` |
| `frozen` | announced big works: new worksites discouraged or refused for a period | created by teams, never by the catalogue |
| `out-of-scope` | ignored | `dist/**`, `**/__snapshots__/**`, `*.generated.*` |

The default catalogue is applied when a repository is added, then corrected by the team. A zone
can be linked to a Jira component — that link is the first basis of prediction. Zones are
reclassified from facts (spec §13, lot S): a file where overlaps never produce a conflict is
proposed as a hotspot; a folder where they always do is proposed as exclusive.

## Degrees and modulations (spec §7)

| Degree | Situation | Verdict |
|---|---|---|
| D0 | same named zone, different files | `free`, neighbour still mentioned |
| D1 | same folder | `caution` |
| D2 | same file | `caution`: read the neighbour worksite before editing |
| D3 | same file, and one side deletes, moves or renames it | `wait`, or coordinate |
| D4 | exclusive resource, reserved zone or frozen zone | `wait`; `stop` if the project enabled hard mode |
| D5 | broken contract: a worksite changes what another uses, no common file (lot C) | coordinate |

Modulations: hotspot −1; dormant neighbour (no activity since the dormancy delay) −1; a
prediction-only side caps the degree at D1 and tags it `probable`; a neighbour with an open,
approved PR gets "wait for the merge, it is close" advice instead of a plain wait.

**Two agents driven by the same person get no discount** — that is the most frequent and most
expensive case. Only the recipient of the alert changes: one pilot to warn, tagged `your two
agents`.

## Worksite lifecycle (spec §11)

`planned` → `open` → `active` → `paused` → `review` → `dormant` → `closed`, with two guarantees
enforced by the five-minute sweep: **no eternal reservation** (120 min default, 1440 max, extended
by observed activity, released at expiry) and **no ghost worksite** (dormant after
`priority_rule.dormancy_hours` — 24 h default — closed after `DORMANT_CLOSE_DAYS` = 7, pilot
notified before). Closing a worksite releases the neighbours waiting on it.

## The hook (spec §9.3)

The hook runs in the agent client, **before every file edit**. It exists because an agent can
forget the protocol; the client cannot.

| Event | Type | Role |
|---|---|---|
| `SessionStart` | `command` (the only accepted types are `command` and `mcp_tool`) | `templates/hook/hook.sh open`: read the branch, find the ticket key (`[A-Z][A-Z0-9]+-[0-9]+`), open the worksite; the response injects the neighbour list into the agent context. |
| `PreToolUse` on `Edit\|Write\|NotebookEdit` | `http` | posts the raw event to `/touch`; the path enters the **observed** footprint. Caution → `additionalContext`; hard mode + reserved/frozen zone → `permissionDecision: "deny"` with the reason and the release time. |
| `SubagentStart` | — | opens a sub-worksite and injects the neighbours into the sub-agent's context (lot S). |
| `SessionEnd` | `command` | `templates/hook/hook.sh close`: pause the worksite. 1.5 s budget; if it fails, dormancy is the safety net. |

**Fail-open, by design.** The hook has a 3-second budget; if the app does not answer, the agent
continues. A non-2xx response or a connection failure does not block (no `onFailure: "block"`).
The product advises; it only refuses where the project decided to (hard mode, reserved or frozen
zone).

**What the endpoint receives, and what it keeps.** The client sends its event as-is: for an edit
that includes the path **and** the replaced text and the new text. The endpoint reads only the
path, the session and the working directory, and **discards the rest before any processing and any
storage**. For teams that do not want content to leave the machine at all, a variant replaces the
`http` hook with a local script that sends only the path, and only on the first edit of each file.

`WorktreeCreate` is **not** used: configuring it replaces git's own worktree creation.

## Web trigger `ingest`

`urlFormat: v2` + `response: { type: dynamic }`. URL shape:

```
https://<INSTALLATION>.webtrigger.atlassian.app/v2/<APP_ID>/ingest/<route>
```

| Route | Caller | Body | Effect |
|---|---|---|---|
| `/open` | `SessionStart` script | `{ sessionRef, branch, cwd?, agentRef? }` | opens (or resumes) the worksite for the ticket found in the branch; returns the neighbour list as `additionalContext`. |
| `/touch` | `PreToolUse` `http` hook | the raw client event (`tool_input.file_path`, `session_id`, `cwd`, `agent_id`, `agent_type`) | adds the path to the observed footprint, replays detection, returns `additionalContext` or a `deny`. |
| `/close` | `SessionEnd` script | `{ sessionRef, reason? }` | pauses the worksite (best effort). |
| `/ci/footprint` | CI step | `{ repoSlug, branch, baseBranch?, issueKey?, files[], prOpen?, prApproved? }` | attested footprint; works for humans with no tooling at all. |
| `/ci/conflict` | CI step | `{ issueKey, repoSlug, paths, withIssueKey? }` | records a real merge/rebase conflict and whether the app had seen it coming. |

Auth: `Authorization: Bearer <token>`, plus the optional `X-Chantier-Repo` header. The response is
hook JSON (`hookSpecificOutput` with `additionalContext` or `permissionDecision`).

The three CI templates in `templates/ci/` are one job each: `git diff --name-only
origin/<base>...HEAD` posted as JSON to `/ci/footprint`, plus an optional second step that
reports the paths in conflict to `/ci/conflict` when merging the base branch really conflicts.
They read `CHANTIER_URL` (ingest base URL, no trailing route) and `CHANTIER_PROJECT_TOKEN`
(the CI-scoped token above) from the platform's secret store.

## Tokens (spec §17)

- Every developer generates a **personal token** in the personal settings. It is shown **once**;
  the app stores only its **sha256 fingerprint** (`hook_token.token_hash`), never the clear value.
- A **project token** is limited to sending attested footprints and real conflicts
  (`/ci/footprint`, `/ci/conflict`). It cannot declare, reserve or close anything.
- Identity always comes from the token or from the MCP call context — never from a tool input.

## Scheduled jobs

| Trigger | Interval | Work |
|---|---|---|
| `five-minute-sweep` | `fiveMinute` | idle worksites → dormant; dormant ≥ 7 days → closed (pilot notified); expired reservations released and queued neighbours freed. |
| `daily-jobs` | `day` | refresh predictions for open tickets (component + similar merged tickets + ticket text via Forge LLM, cached); compare predicted vs attested footprints of merged worksites to publish prediction accuracy. |

## Data model — 14 tables (spec §18, DDL in `src/storage/schema.ts`)

| Table | Role |
|---|---|
| `repo` | A repository registered for a Jira project (provider, slug, default branch). The anchor of every footprint and of every overlap search. |
| `zone` | A named part of a repository: glob patterns, nature, optional Jira component link, frozen window. Drives degrees and hard-mode refusals. |
| `actor_session` | One actor session: account, kind (human/agent), client, session ref, agent ref, parent session (sub-agent), first/last seen. Distinguishes the four agents of one pilot. |
| `worksite` | The unit of work: ticket + repository + session + account + branch + state + timestamps + outcome, plus `pr_open` / `pr_approved` and `parent_worksite_id`. |
| `footprint` | One row per footprint entry: path, kind (file/folder/pattern), **source**, mode, first/last seen, `declared_mismatch`. `repo_id` is denormalised so the overlap search needs no join. |
| `collision` | One row per (pair of worksites, zone): degree + `raw_degree` (before modulation), phase, state, resolution, resolved_by, reason, detected_at, `probable`. |
| `reservation` | A bounded exclusive claim: patterns, `hard` flag, reason, created/expires/released. Nothing eternal. |
| `notice` | A short message from a worksite about paths (the "site mail", spec §9.4). |
| `notice_recipient` | The per-worksite delivery ledger — a notice is delivered **once** per session. (Spec §18 calls this `notice_delivery`, keyed by session; the schema keys it by worksite.) |
| `prediction` | One row per predicted path, with confidence, overall confidence and `basis_json`; keyed by `issue_key` + repo (spec §18 says `issue_id`). |
| `real_conflict` | A conflict that actually happened at merge/rebase, with `was_detected` — the app's own accuracy measure (spec §13). |
| `priority_rule` | Per project: the yield order (`order_json`), `agent_yields`, `hard_mode`, `dormancy_hours`. |
| `hook_token` | Personal and project tokens: sha256 hash, scope, project, created/last used. |
| `event` | Append-only journal (`seq` auto-increment, `at`, `kind`, `worksite_id`, `payload_json`) — the audit trail behind the panel and the four dashboard numbers. |

## Forge SQL limits, respected

- **No foreign keys** — referential integrity is enforced in `src/services/*`, not in the DDL.
- **1 GiB per installation in production** — the app stores **paths, never file content**; the
  hook discards content at the entrance; `event.payload_json` is kept small.
- **5 s per SELECT** — the overlap search is served by the `(repo_id, path)` index, scoped to one
  repository and to non-closed worksites only; the degree computation then happens **in memory**
  over that reduced set (target: verdict < 2 s over MCP, < 1 s over the hook in 95 % of cases, for
  50 worksites × 500 paths).
- DDL is idempotent (`IF NOT EXISTS`), so `ensureSchema()` can run on every cold start.
- Two storage implementations behind one interface (`src/storage/interfaces.ts`): `forge/` for
  production, `memory/` for tests and for the simulation console — which is how judges can replay
  a scenario with no repository and no Jira site.
