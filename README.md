# Chantiers en collision

Forge app for Jira · **Codegeist 2026**, category *Apps for Software Teams* · MIT licence.

**▶ Live demo — no install, no Jira, works on mobile:**
**<https://baptistefaisy.github.io/chantiers-en-collision/>**
The page runs the REAL collision engine compiled for the browser (in-memory stores):
a two-agent verdict playground and the full “Four agents” scenario, replayable step by step.

**Companion repositories**
- [`BaptisteFaisy/billing-demo`](https://github.com/BaptisteFaisy/billing-demo) — the sample repo judges clone: hook, CI step and curl scripts ready (walkthrough inside).
- [`BaptisteFaisy/open-footprint-protocol`](https://github.com/BaptisteFaisy/open-footprint-protocol) — the open protocol: any agent, any backend — spec, JSON schemas, reference server, skill.
- [`docs/WATCHER.md`](docs/WATCHER.md) — `chantier-watch`: makes *any* editor or agent visible (Cursor, Aider, Copilot CLI, Codex…), even without a native hook.

> Pitch, verbatim from the spec (docs/SPEC.md §1):
> « Jira sait à chaque instant qui travaille sur quelle partie du code, personnes et agents
> confondus : chaque travail en cours a une emprise sur le dépôt, tout chevauchement est
> signalé avant la première ligne écrite, et l'app dit quoi faire — attendre, se coordonner,
> découper, ou lancer en parallèle sans risque. »

In English: Jira knows, at every instant, who is working on which part of the code — people and
agents alike. Every work in progress has a **footprint** on the repository. Every overlap is
flagged **before the first line is written**, and the app says what to do: wait, coordinate,
split, or run in parallel safely.

## The problem

Two developers editing the same file has always happened. They found out at merge time, or
earlier, because they talked to each other.

What changed is the number and the nature of the actors: one person starts four coding agents
in parallel, each in its own working copy. Worktrees isolate files, not intentions. Agents do
not attend the daily stand-up and do not read the board. They are fast: in twenty minutes, four
worksites have diverged.

The result shows up at merge time: two migrations carry the same number, one agent renamed a
service the other three still call, the lockfile was regenerated three times, two agents each
wrote their own version of the same helper. The conflict is then resolved by an agent that does
not know the other one's intent: it keeps a version, overwrites the other, and the regression is
silent.

Jira knows who works on which **ticket**, but not on which **code**. Git knows which code
changed, but only after the push. Nobody knows the intent at the moment it matters.

## What the app does

- **A footprint per worksite**, from four sources (predicted, declared, observed, attested). The
  fact beats the intent: if an agent edits outside what it declared, the footprint widens and
  the gap is noted.
- **A verdict** on every declaration: `free`, `caution`, `wait`, `stop`.
- **Six degrees of collision**, D0–D5: same zone (D0), same folder (D1), same file (D2), same
  file with a delete/move/rename (D3), exclusive resource / reserved / frozen zone (D4), broken
  contract (D5). Hotspots, dormant neighbours and prediction-only footprints modulate the degree
  (spec §7).
- **Six ways out of every collision** (spec §8): wait, sequence, coordinate, split, merge,
  override (with a reason). Every verdict names the neighbour, cites the path and says what to
  do — no anonymous warnings.
- **Waves**: `plan-parallel-work` turns a JQL query and a worker count into collision-free waves,
  hinge tickets first and alone.
- **Nothing eternal**: reservations expire (2 h default, 24 h max), idle worksites go dormant
  then close themselves.
- **Nobody has to install anything**: a branch moved to *In progress*, the issue panel, or the CI
  step makes a human developer visible too.

## Quickstart — judges

No code repository is needed for the first three steps; the fourth needs nothing but `curl`.
Full walkthrough, expected output included: **[docs/JUDGES.md](docs/JUDGES.md)**.

1. **In Jira alone.** Open the simulation console, replay the *Four agents* scenario, then the
   worksite map, the panel of the sample ticket, the sprint check and the Rovo agent
   ("Site foreman").
2. **With an MCP client.** Enable external exposure (Rovo MCP is served over OAuth 2.1), connect
   your client, call `declare-footprint` twice with two different `session` values and read the
   two verdicts.
3. **With the hook.** Clone the public example repository (it already contains `.chantier/` and
   the hooks settings file), set your personal token, start two agent sessions.
4. **Without installing anything.** Two `curl` commands (see docs/JUDGES.md §4) simulate a CI
   push and make an **attested** footprint appear for a developer who never touched the app.

## Quickstart — developers

```bash
npm install
npm run verify          # lint + typecheck + manifest gate + tests
```

`npm run verify` is the whole local gate. It runs `eslint`, `tsc --noEmit`,
`node scripts/check-manifest.mjs` (tools ↔ actions ↔ functions consistency) and `vitest run`.

```bash
npx forge create        # once: creates the app, prints its id (put it in manifest.yml)
npx forge lint          # schema validation of manifest.yml beyond the local gate
npx forge deploy        # install/upgrade the app on the development environment
npx forge install       # install it on a Jira site
```

Replace the placeholder `app.id` in `manifest.yml` with the real id given by `forge create`.
Never commit a real token. The `forge:*` scripts are not in `package.json` on purpose: the Forge
CLI is a global/one-shot tool, and `npm run verify` must stay runnable without it.

### Repository layout

| Path | Contents |
|---|---|
| `manifest.yml` | Forge modules: `rovo:mcp` (16 tools), 16 `action` entries, the `ingest` web trigger, 7 Jira UI modules, 2 JQL functions, triggers, the Rovo agent and skill, 20 functions. |
| `src/core/` | Pure logic, no Forge import: paths, zones, degrees, collisions, verdict, footprints, lifecycle, notices, prediction, priority, waves. |
| `src/services/` | Orchestration over stores + `ctx` (identity, clock, Jira port): declare, worksites, notices, reservations, resolve, planning, ingest, maintenance, tokens. |
| `src/storage/` | `schema.ts` (Forge SQL DDL), `forge/**` (SQL implementation), `memory/**` (tests + simulation). |
| `src/simulation/` | The simulation console engine and its ready-to-replay scenarios (`four-agents`). |
| `src/ui/` | Forge UI screens: issue panel, worksite map, sprint check, settings, gadget, simulation console. |
| `src/i18n/` | English and French message dictionaries (submission language: English). |
| `src/index.ts` | Every handler the manifest references. |
| `prompts/` | `site-foreman.md` (Rovo agent) and `avoid-collisions.md` (Rovo skill). |
| `templates/` | Shipped artefacts: `hook/` (settings + script), `ci/` (Bitbucket, GitHub, GitLab), `skill/` (`SKILL.md`). |
| `docs/` | `SPEC.md` (product spec, French), `CONTRACTS.md`, `ARCHITECTURE.md`, `PROTOCOL.md`, `JUDGES.md`. |

## Architecture (short)

One Forge app installed on Jira. Agents talk to it over **Rovo MCP** (16 tools); agent clients
and CI talk to it over one **web trigger** (`ingest`, routes `/open`, `/touch`, `/close`,
`/ci/footprint`, `/ci/conflict`); humans talk to it through **Jira UI** modules and a **Rovo
agent**. Everything is persisted in **Forge SQL** (14 tables, no foreign keys), and two scheduled
triggers do the housekeeping (dormancy/expiry every five minutes, predictions and learning
daily).

Full detail — step-by-step declaration, data model, footprint sources, zones, degrees, hook
behaviour, tokens, scheduled jobs, Forge SQL limits: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.
The agent protocol itself: **[docs/PROTOCOL.md](docs/PROTOCOL.md)**.

## The 16 MCP tools

Exposed by the `chantiers-mcp` Rovo MCP server; each one maps to one `action` entry in
`manifest.yml`. Verbs are Forge `actionVerb` values.

| Key | Verb | What it does |
|---|---|---|
| `declare-footprint` | CREATE | Declare the paths you are about to touch; get a verdict, every collision, the neighbour's name and what to do instead. |
| `check-zone` | GET | Verdict for paths without declaring anything. |
| `who-touches` | GET | Worksites currently present on a path, with state and last activity. |
| `get-worksite` | GET | Full panel data for a ticket: footprint by source, neighbours, collisions, notices. |
| `predict-footprint` | GET | Predicted footprint from the component and similar merged tickets; never blocking, shown with its confidence. |
| `list-collisions` | GET | Colliding pairs for the tickets matched by a JQL query, with degree and state. |
| `list-clear-work` | GET | Ready tickets nobody collides with — what an idle agent can start now. |
| `next-clear-ticket` | GET | The dispatcher: THE next ticket this worker can start, ranked by priority and due date, with two alternatives. |
| `plan-parallel-work` | GET | Split the tickets of a JQL query into collision-free waves for N workers; hinges go alone and first. |
| `measure-parallel-width` | GET | How many agents this repo supports at once, the bottleneck zones, and what splitting the top bottleneck would buy. |
| `reserve-zone` | CREATE | Reserve paths for a limited time (120 min default, 1440 max). Always expires. |
| `post-notice` | CREATE | Send a short notice to neighbouring worksites; delivered once per session. |
| `resolve-collision` | UPDATE | Record how a collision is handled: wait, sequence, coordinate, split, merge, override. |
| `close-worksite` | UPDATE | Close a worksite (merged / abandoned / done) and release the waiting neighbours. |
| `report-conflict` | CREATE | Report a real merge/rebase conflict so the app learns whether it saw it coming. |
| `create-hook-token` | CREATE | Create a personal or project hook token (shown once) — the entry pass for the hook, the watcher and the CI step. |

Inputs are simple values only (Forge action limitation): `paths` is one string, **one path per
line**; `mode` is `edit`, `create`, `delete` or `rename`. Identity never comes from an input — it
comes from the call context or from the token (spec §9.6).

## Scope: M / S / C

Priorities from spec §14 — **M** required for the submission, **S** desirable, **C** after the
hackathon. 28 requirements in total.

| Priority | Count | Highlights |
|---|---|---|
| **M** | 17 (CC-01…CC-17) | worksite lifecycle, declared footprint with a verdict under 2 s, D0–D4 detection, zones and the default catalogue, hook endpoint, per-session distinction, bounded reservations, notices delivered once, issue panel, the 16 MCP tools, `plan-parallel-work`, prediction, CI attested footprint, worksite map, simulation console, Rovo agent + skill, dormancy and auto-close. |
| **S** | 8 (CC-18…CC-25) | "Collisions" custom field + JQL functions, sprint check, configurable yield order and the *sequence* way out, hard mode (hook deny), Bitbucket companion app, sub-worksites for sub-agents, LLM-based prediction from ticket text, measured real conflicts and zone reclassification. |
| **C** | 3 (CC-26…CC-28) | D5 broken contracts from declared symbols, cross-repository collisions, non-code worksites (Confluence pages, Jira config touched by Rovo agents). |

## CI

Three jobs on self-hosted runners, each capped at **5 minutes** (`timeout-minutes: 5`,
`concurrency` with `cancel-in-progress`, `fetch-depth: 1`, npm cache):

| Job | Runs |
|---|---|
| `quality` | `npm run lint` + `npm run typecheck` |
| `test` | `npm run test` (vitest) |
| `manifest` | `npm run check:manifest` (tools ↔ actions ↔ functions consistency) |

The `ci-budget` guard (`.github/workflows/ci-budget.yml` + `.github/ci-budget/check_timeouts.py`)
fails the build if any job declares more than 5 minutes, or no timeout at all. Long suites and
native builds stay out of PRs.

## CI infrastructure

This repository was bootstrapped with the shared **socle** for self-hosted CI and keeps its
pieces:

- **Runners**: self-hosted GitHub Actions workers on **r630** (Debian 13, 80 cores), labels
  `self-hosted, chantiers-en-collision-worker, ci-node, Linux, X64`, systemd services
  `actions.runner.<owner>-<repo>.r630-<repo>-0N.service`.
- **ci-budget guard**: every CI verdict in ≤ 5 minutes (house rule, 2026-10-24). The `ci-budget`
  check is required by the Mergify queue conditions, so it always exists.
- **Mergify** (`.mergify.yml`): merge queue, rebase, batching, `urgent` / `priority-low` labels.
- **hermes-lite gate** (`.github/workflows/hermes-lite.yml` + `.github/hermes/gate.py`): running
  in dry-run — it evaluates and labels (`hermes/approuvee` / `hermes/conflit`), it does not merge.
- **stale-base-guard**: informational check for branches lagging behind the base.
- **Shared step** `.github/actions/npm-cache`: restores `~/.npm` + `node_modules` from the
  lockfile hash, then `npm ci`.

## Licence

MIT — see [LICENSE](LICENSE). Built for Codegeist 2026, category *Apps for Software Teams*.
