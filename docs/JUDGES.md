# Judge guide

## Route 0 — start here: the site

**<https://tradoooo.github.io/chantiers-en-collision/>** — the single entry point for a judge,
no install, no Jira, nothing to run. The page is the **deployed** Forge app, not a mock:

- **Playground** — two agents declare footprints and you read the verdict (presets: same file →
  D2 caution, two migrations → D4 wait, hotspot translations → lowered degree).
- **Live worksites** — the band reads `/demo/state`: the real worksites of `acme/billing` in
  Forge SQL, refreshed every 10 s. The playground calls `/demo/verdict`, so the verdict you get is
  the one the running engine computed against those worksites — D2 collisions against
  PROJ-1/PROJ-10/PROJ-12 as they really are.
- **Scenario** — the eleven-step “Four agents” story replays live, with every expectation checked.
- **Live proof** — the deployment's own counters (worksites, collisions, events).

The bundle is the real TypeScript engine (services + core + in-memory stores) via esbuild, and it
is verified in CI (`site` job, `scripts/check-site-bundle.mjs`) — what you click is what the tests
run. If the deployment is asleep the page says so and falls back to the same engine locally.


### Behind the site: the app is ALREADY deployed with real data

Development environment on `one-atlas-cndz.atlassian.net`, app id `2ef208cc-6621-42a7-8557-5ce5ab3f6882`:
project **PROJ** with 8 real tickets (components billing/database/auth/i18n, priorities, due dates),
4 of them In Progress with CI-attested footprints, **2 open collisions** (a D4 on the exclusive
migrations resource, a D2 on `src/billing/invoice.ts`), one agent session live. The end-to-end smoke
(`scripts/smoke-e2e.sh`) passes **8/8** against the live web trigger, and the universal watcher was
verified against it (real D2 verdicts printed in the terminal). Re-seed anytime with
`scripts/seed-jira-demo.py`. The LLM prediction fallback (CC-24) is wired to the inferhub gateway
(encrypted Forge variable): creating PROJ-8 triggered a planned worksite with a predicted footprint.


## Four test paths

In increasing order of setup. **The first needs nothing but a browser**; the fourth needs nothing
but `curl`. The demo site ships without a code repository, which is why path 1 exists (spec §24).

## Before you start — two values you will need

| Value | Where |
|---|---|
| Ingest base URL `https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ` | the deployment's web trigger, copied from the `Hook & CI` tab of the project settings page. |
| Personal token | the MCP tool **`create-hook-token`** — ask the **Site foreman** agent in Rovo Chat (or call it from any Rovo MCP client). Shown **once**; the app only keeps its sha256 fingerprint. |

Every request below uses `Authorization: Bearer <token>`. Export both once:

```bash
export CHANTIER_URL="https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ"
export CHANTIER_TOKEN="<your personal token>"
```

`create-hook-token` mints both scopes: the **personal** token works everywhere; the **project**
token is restricted to `/ci/footprint` and `/ci/conflict`. Either token works for path 4.

---

## Path 1 — The browser and Jira alone (no repository, no client)

**1.1 Simulation console, scenario "Four agents".**
On the site (Route 0), the **“Four agents, one repo”** scenario replays live with every expectation
checked. One pilot drives four agent sessions on `acme/billing`. It runs against the in-memory
stores with a controllable clock: no repository, no Jira data, no network.

| Step | What the scenario does | What you should see |
|---|---|---|
| 1 | Agent 1 declares `src/billing/` for **PROJ-88** | `free` — no neighbour yet. |
| 2 | Agent 2 touches `src/billing/invoice.ts` for **PROJ-101** | `caution`, **D2**, same file; the neighbour is **named**: PROJ-88, its actor label ("agent of …, session …"), state and "active n min ago". |
| 3 | Agent 4 reserves `db/migrations/`; agent 3 declares `db/migrations/0042_x.sql` for **PROJ-93** | `wait`, **D4**, exclusive resource `migrations` cited, with the reservation's release time and the advice "keep working outside db/migrations/, then redeclare". |
| 4 | Agent 4 posts a notice: *"renaming invoices.total to total_cents"* | The notice is queued for the neighbours. |
| 5 | Agent 2's **next** call | The notice is delivered **once** with the response (`neighbor's notice:` line). Call again: it is gone. |
| 6 | PROJ-88 is closed | Agent 2's next check answers **`free`** — the neighbour was released. |

Every step shows PASS/FAIL against its expected verdict, and the run ends with an overall result.
Replaying is idempotent: the stores are rebuilt from scratch each run.

**1.2 Worksite map.** Project page → *Worksite map*: the repository tree coloured by occupation —
who is where, since when, at which degree — plus the collision graph and the proposed waves.

**1.3 Issue panel.** Open the sample ticket → *Worksite* panel: footprint **grouped by source**
(predicted / declared / observed / attested), neighbours, collisions with their six ways out,
notices sent and received, and the "I'm working on it" button.

**1.4 Collision listing (MCP tool `list-collisions`).** The sprint-check screen is not deployed
(it needs Custom UI). The same read is available anywhere through the `list-collisions` MCP tool:
give it a JQL query and it returns the colliding pairs with their degree and state — the hinge
tickets and the advised order come from `plan-parallel-work` with the same JQL.

**1.5 Rovo agent.** In Rovo Chat, ask the **Site foreman**: *"Who is touching billing right
now?"*, *"Can I run PROJ-101 and PROJ-102 in parallel?"*, *"Plan sprint 42 for four agents."* It
answers from the six read-only tools; it never declares anything on your behalf.

---

## Path 2 — With an external MCP client

Rovo MCP is a Preview module served over **OAuth 2.1**. The server is published at
`https://mcp.atlassian.com/forge/2ef208cc-6621-42a7-8557-5ce5ab3f6882` (an unauthenticated
`initialize` answers `401 invalid_token` — the healthy challenge). Connect any MCP client
(Claude Desktop, Claude Code, Cursor, Rovo Chat) to that URL: it registers itself (DCR),
you consent once (OAuth), then call the tools. The connection details are in
[`docs/DEPLOY.md`](DEPLOY.md#the-remote-mcp-server-is-published--how-a-client-connects).

**2.1 First declaration** — `declare-footprint`:

```json
{
  "issueKey": "PROJ-88",
  "repo": "acme/billing",
  "paths": "src/billing/\nsrc/shared/money.ts",
  "mode": "edit",
  "etaMinutes": 45,
  "session": "judge-session-1"
}
```

Expected: `verdict: free` (nothing else is open), the declared footprint visible in the PROJ-88
panel, tagged **declared**.

> `paths` is a single string, **one path per line** — Forge actions only accept simple values.
> `session` distinguishes sessions; it never grants a right. Identity comes from the OAuth context.

**2.2 Second declaration, other session** — same tool, overlapping path:

```json
{
  "issueKey": "PROJ-101",
  "repo": "acme/billing",
  "paths": "src/billing/invoice.ts",
  "mode": "edit",
  "session": "judge-session-2"
}
```

Expected: `verdict: caution`, **D2** (same file), PROJ-88 named with its actor, state and last
activity, plus a concrete "what to do" line. The PROJ-88 panel now lists PROJ-101 as a neighbour.

**2.3 Exclusive zone** — declare `db/migrations/0043_x.sql` from a third session while PROJ-88
holds a reservation on `db/migrations/`: `verdict: wait`, **D4**, exclusive resource cited,
release time given.

**2.4 Read-only tools worth a call:** `check-zone` (verdict without declaring), `who-touches`
(who is on a path), `get-worksite` (full panel data), `list-clear-work` (what an idle agent can
start now), `plan-parallel-work` with `{"jql": "sprint = 42", "workers": 3}` (collision-free waves,
hinges first).

**2.5 Clean up:** `close-worksite` with `{"issueKey": "PROJ-101", "outcome": "abandoned"}` — the
neighbour is released and PROJ-88's next call answers `free`.

---

## Path 3 — With the agent-client hook

Clone the **public example repository**: it already contains `.chantier/hook.sh` and the hook
settings snippet. Only the token stays on your machine.

```bash
git clone <example-repo-url> && cd <example-repo>
git checkout -b feature/PROJ-101
export CHANTIER_TOKEN="<your personal token>"     # never committed
export CHANTIER_URL="https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ"
```

Merge `templates/hook/settings.json` (same content as the repo's `.chantier/settings.json`) into
your client's settings file — Claude Code: `.claude/settings.json`. Replace `<INSTALLATION>` and
`<APP_ID>` in the `PreToolUse` URL.

**3.1 Start two sessions** (two worktrees, or two terminals on two branches `feature/PROJ-88` and
`feature/PROJ-101`).

- On `SessionStart`, the script reads the branch, extracts the ticket key with
  `[A-Z][A-Z0-9]+-[0-9]+` and POSTs it to `/open`, which opens the worksite. **Its stdout is
  injected into the agent's context**: you should see the neighbour list appear before the agent
  writes anything.
- On the first `Edit`/`Write`/`NotebookEdit`, the path is POSTed to `/touch`. If it overlaps
  another worksite, the agent receives `additionalContext`, e.g.:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Neighbour worksite: PROJ-88 (agent of Léa, PR open) is also editing src/billing/invoice.ts. Notice: \"renaming invoices.total to total_cents\". Read that PR before editing this file."
  }
}
```

- With **hard mode** on and a reserved zone, the edit is refused:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "db/migrations/ is reserved by PROJ-88 until 15:10. Keep working outside that folder, then redeclare."
  }
}
```

**3.2 Fail-open proof.** Unset `CHANTIER_URL` (or point it at a dead host) and edit a file: the
agent is **not** blocked. The script exits 0 after at most 3 s (1.5 s on `SessionEnd`) whatever
happens; the session is simply marked "not observed".

**3.3 Close.** Ending the session runs `hook.sh close` → the worksite goes to `paused`. If that
call fails, dormancy takes over (24 h idle → dormant, 7 days → closed).

---

## Path 4 — Without installing anything: two `curl` commands

This is the CI path. It makes an **attested** footprint appear for a developer who has no agent,
no hook and never opened the app.

**4.1 Simulate a push** (`/ci/footprint`) — the body is what the CI templates in `templates/ci/`
send: the list of files changed since the divergence point with the base branch (they add the
optional `issueKey` they extract from the branch name).

```bash
curl -sS -X POST "$CHANTIER_URL/ci/footprint" \
  -H "Authorization: Bearer $CHANTIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "repoSlug": "acme/billing",
        "branch": "feature/PROJ-120",
        "baseBranch": "main",
        "files": ["src/billing/refund.ts", "src/billing/invoice.ts", "db/migrations/0044_refund.sql"]
      }'
```

What you should see:

- a worksite for **PROJ-120** appears in the project's worksite map, with
  a footprint tagged **attested** (3 entries);
- `src/billing/invoice.ts` now overlaps PROJ-88 / PROJ-101 → a collision appears on both panels,
  and `who-touches` on that path lists the new worksite;
- `db/migrations/0044_refund.sql` lands in the exclusive zone → **D4** with the migration
  reservation cited, even though nobody declared anything.

**4.2 Report a real conflict** (`/ci/conflict`) — what the CI step sends when a rebase or a merge
actually conflicted:

```bash
curl -sS -X POST "$CHANTIER_URL/ci/conflict" \
  -H "Authorization: Bearer $CHANTIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "issueKey": "PROJ-120",
        "repoSlug": "acme/billing",
        "paths": "src/billing/invoice.ts\ndb/migrations/0044_refund.sql",
        "withIssueKey": "PROJ-88"
      }'
```

What you should see: a `real_conflict` row with `was_detected` set from whether the app had an
open collision on that pair and those paths. The dashboard gadget counts it in the fourth number —
collisions **missed** until merge — which is how the app measures itself (spec §13).

**4.3 Optional third call** — close the worksite the way a merge would:

```bash
curl -sS -X POST "$CHANTIER_URL/close" \
  -H "Authorization: Bearer $CHANTIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionRef": "ci-PROJ-120", "reason": "merged"}'
```

---

## What to check in any path

- **No verdict without a named neighbour, a cited path and a "what to do" line** (spec §8). A bare
  "collision detected" is a bug.
- **Notices arrive once per session**, not once per file, not once per call.
- **Nothing is stored but paths.** After a full hooked session, no table contains file content
  (spec §22.14): the hook endpoint discards everything but path, session and working directory
  before processing.
- **Everything expires.** A reservation left alone is released by the five-minute sweep; the next
  declaration answers `free`.
- **Two agents of the same pilot collide too**, tagged `your two agents`, with one single alert to
  that pilot.
