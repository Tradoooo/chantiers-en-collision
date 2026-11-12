# Deploy — first-time runbook

How to get **Chantiers en collision** from this repository to a deployed Forge
app that the four judge paths in `docs/JUDGES.md` can exercise against a real
site. Target audience: the submitter (you) on the primary machine.

---

## Prerequisites

- A **free Atlassian Cloud site** (`https://<your-site>.atlassian.net`) — any
  Jira Cloud plan works, Free included.
- An **Atlassian account** that is a site admin on that site.
- **Node.js ≥ 18** on the machine doing the deploy (the Forge CLI needs it).
- **curl** and **python3** (used by the E2E smoke, not by the deploy itself).

### ⚠️ Warning: `forge` on this machine is Foundry, not Forge

On this machine the global `forge` binary is **Foundry** (the Solidity
toolchain, "Lint Solidity source files"), *not* the Atlassian Forge CLI. Running
bare `forge` will silently lint nothing or error out.

**Always** invoke the real CLI through npm, exactly like this:

```bash
npm exec --package @forge/cli -- forge <command>
```

Alternatively, install `@forge/cli` as a local dev dependency in a scratch
folder and call its `bin/forge.js` directly. Never rely on the global `forge`.

> Forge CLI itself can be run with any reasonably recent Node; on this machine
> the self-hosted CI PATH points at `node-v22.12.0` (see `.github/workflows/*.yml`).

---

## Deploy steps

1. **Log in.**

   ```bash
   npm exec --package @forge/cli -- forge login
   ```

   A browser opens; approve the OAuth scope for your Atlassian account. You must
   be a **site admin** to install later.

2. **Create the app (once).**

   ```bash
   npm exec --package @forge/cli -- forge create
   ```

   Answer with a unique app name (e.g. `chantiers-en-collision`). The CLI prints
   an app id of the form `ari:cloud:ecosystem::app/<uuid>`.

3. **Adopt the app id.** Replace the placeholder in `manifest.yml`:

   ```yaml
   app:
     id: ari:cloud:ecosystem::app/<real-uuid>
   ```

   Never commit a private credential here — the app id alone is not a secret,
   but the running app's tokens are.

4. **Lint the manifest.**

   ```bash
   npm exec --package @forge/cli -- forge lint
   ```

   This is the authority the local gate (`node scripts/check-manifest.mjs`) cannot
   be: the module schemas (`rovo:mcp`, `action`, `webtrigger`, Jira modules,
   `trigger`, `sql`, `rovo:agent`/`rovo:skill`, `function`) are validated by the
   CLI. Fix anything it flags before deploying.

5. **Deploy to the development environment.**

   ```bash
   npm exec --package @forge/cli -- forge deploy
   ```

   This uploads the code to Forge. It does **not** put the app on your site yet —
   that is the `install` step below.

6. **Install on the site.**

   ```bash
   npm exec --package @forge/cli -- forge install
   ```

   Choose **Jira**, pick your site, then the target project. Installing emits a
   `jira:customField` (the "Collisions" field) and all the UI modules.

---

## Post-deploy configuration

### The "Collisions" custom field — how the code reads it

The `jira:customField` is declared in `manifest.yml` (`key: collisions-field`,
`name: "Collisions"`, `type: string`, `readOnly: true`) and created for you at
install time. The app does **not** hard-code its Jira field id: Forge assigns
`customfield_xxxxx` per install.

Resolution is implemented in `src/glue/jira-port.ts`
(`makeFieldIdResolver`, used by `setCollisionsField`), in this exact order:

1. **Environment override first** — the variable
   `CHANTIERS_COLLISIONS_FIELD_ID` (constant `COLLISIONS_FIELD_ENV` in
   `jira-port.ts`), if set, is used as-is.
2. **Fallback** — a `GET /rest/api/3/field` call finds the field whose `name`
   equals `"Collisions"` and uses its `id`. The result is cached once per
   container.
3. **Unresolvable → skip.** If neither works, the write is skipped and nothing
   is fatal — the panel still renders the data from Forge SQL.

So the field-resolve step is **optional** (the name lookup usually suffices).
If you want the env override, set it with the Forge CLI's variables command where
available:

```bash
npm exec --package @forge/cli -- forge variables list
npm exec --package @forge/cli -- forge variables set CHANTIERS_COLLISIONS_FIELD_ID customfield_10042
```

> Note: the exact variables command name varied across CLI releases. If
> `forge variables` is not present in your installed CLI, the name-based lookup
> already works without it — leave the field id out and confirm the field is
> named exactly **Collisions** on the site.

### Rovo MCP (Preview) — EAP form

`rovo:mcp` is a **Preview** module. Before the app's MCP server can be exposed
externally, the app (or your account) must be in the Rovo MCP
Early-Access program. Fill in the registration form on
`developer.atlassian.com` (search **"Rovo MCP Server (Preview) EAP"**). Without
this, Path 2 in `docs/JUDGES.md` returns a module-not-available error.

> Placeholder: the exact form URL is not captured in this repo yet — record it
> here when you fill it in, so the next deployer has it.

### Enable external MCP publication

Even after the EAP flag is on, a **site admin** must allow the app to be reached
by external MCP clients (Rovo MCP is served over OAuth 2.1):

1. Open **admin.atlassian.com** → select your site.
2. Go to **Apps** → **Connected apps**.
3. Find **Chantiers en collision** → open it.
4. Enable **Rovo MCP / external access** (the exact label per the Atlassian
   "Rovo MCP" doc). Once on, external clients can reach the `chantiers-mcp` server
   listed in `manifest.yml`.

> The in-product path quoted in `docs/JUDGES.md` ("Jira admin → apps → Chantiers
> en collision → Rovo MCP / external access") refers to this same toggle.

### Generate the tokens (where, in the UI)

The token screens are Forge UI modules, so they only exist **after** `forge
install`.

- **Personal token** — Jira → **personal settings** → **My worksites** → *Hook
  token* → **Generate token**. Rendered by `src/ui/personalSettings.tsx`; the
  clear value is shown **once**, and the app stores only its sha256 fingerprint
  (`hook_token.token_hash`). Use this token for `/open`, `/touch`, `/close` and
  also for `/ci/*` if you have nothing else.
- **Project token** — Jira → **project settings** → **Worksites** → *Hook & CI*
  tab (per `docs/JUDGES.md`). Restricted to `/ci/footprint` and `/ci/conflict`
  only. Use this for CI (`templates/ci/*`).

### GitHub secrets + smoke workflow

In the repository's **Settings → Secrets and variables**:

- **Actions secrets**: `CHANTIER_SMOKE_TOKEN` (a personal token, so it can drive
  `/open|/touch|/close` too), and optionally `CHANTIER_SMOKE_PERSONAL_TOKEN` if
  you want a distinct personal token for the hook routes while the project token
  drives `/ci/*`.
- **Actions variables** (optional): `CHANTIER_SMOKE_REPO` = the repo slug the
  smoke workshop declares (default `acme/smoke`).

Then trigger the smoke:

```bash
gh workflow run smoke-e2e.yml \
  -f site_url="https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ"
```

Both `…/ingest`-suffixed and unsuffixed `site_url` forms are accepted. Until the
secrets are set, the job prints *"secrets absents — smoke ignorée (à configurer
après le premier forge deploy, voir docs/DEPLOY.md)"* and exits 0 (see
`.github/workflows/smoke-e2e.yml`).

---

## Final checklist — the four judge paths (§24 / docs/JUDGES.md)

After the deploy, walk each path once against the **real** site and update the
placeholders:

1. **In Jira alone.** Simulation console scenario *Four agents*, worksite map,
   issue panel, sprint check, Rovo agent. Nothing to update — all in-product.
2. **With a MCP client.** Requires the EAP flag + external exposure above. No
   URL to write; the client connects to `chantiers-mcp` via OAuth.
3. **With the hook.** Clone the public example repo `acme/billing-demo`. Update
   its `.claude/settings.json` (same shape as `templates/hook/settings.json`):
   replace `<INSTALLATION>` and `<APP_ID>` in the `PreToolUse` URL, and confirm
   `allowedEnvVars: ["CHANTIER_TOKEN"]`. The `.chantier/hook.sh` script needs no
   change.
4. **Without installing anything.** The two `curl` commands in
   `docs/JUDGES.md` §4. Update the exported `CHANTIER_URL`/`CHANTIER_TOKEN`.

### URLs to fill in (search-and-replace targets)

| Where | What to replace |
|---|---|
| `docs/JUDGES.md` | `https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ` (copy button too) |
| `acme/billing-demo` → `.claude/settings.json` | the `PreToolUse` URL `<INSTALLATION>` / `<APP_ID>` |
| `acme/billing-demo` → footprint workflow | secrets `CHANTIER_URL` / `CHANTIER_PROJECT_TOKEN` |
| `templates/hook/settings.json` | `<INSTALLATION>` / `<APP_ID>` in the `PreToolUse` URL |
| `templates/ci/github-actions.yml` | same `CHANTIER_URL` / `CHANTIER_PROJECT_TOKEN` usage (it reads secrets, no edit) |

The billing-demo repo's footprint workflow mirrors `templates/ci/github-actions.yml`:
it posts `git diff --name-only origin/<base>...HEAD` to `/ci/footprint` and, on a
real rebase conflict, the conflicting paths to `/ci/conflict` — both fail-open.

---

## Troubleshooting

- **"Web trigger 404 / wrong URL."** `ingest` uses `urlFormat: v2`: the path
  ends with the route, i.e.
  `https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ/<route>`.
  Routes are matched by suffix, so `/ingest/touch` and `/ingest/ci/footprint`
  both resolve. A trailing route name (`/open`) is **required**; the bare
  `/ingest` is not a route (it answers 200 empty — fail-open — which is *not* a
  request that did anything).
- **Hook route returns 200 with empty body even with a bad token.** That is the
  **fail-open** contract, on purpose: an agent hook call with an unknown/missing
  token stays silent (200 empty) so the agent keeps working. Only `/ci/*` routes
  return **401** for an invalid token, so a broken pipeline step is visible.
- **`/ci/footprint` returns 400.** `repoSlug`, `branch` and a non-empty `files`
  list are all required (`sanitizeCiFootprint` in `src/glue/webtrigger.ts`).
- **Forge SQL quota.** 1 GiB per production install, ≤ 5 s per `SELECT`, no
  foreign keys, and at most **50 tools** on `rovo:mcp` (this app declares 13).
  Watch the daily-jobs trigger (predictions + learning) for query time.
- **Rovo agent prompt looks like a literal string.** `prompt: prompts/site-foreman.md`
  needs Forge CLI ≥ 10.6.0 to resolve a relative path. If it does not, the string
  is taken literally — upgrade the CLI before `forge deploy`.
---

## Deployment actually performed (12 November 2026, ~01:40 Paris) — reproduce as-is

App created, deployed and installed **for real** with `forge-atlassian` 15.1.0
(the global `forge` binary on this machine is Foundry/Solidity), account
`baptiste.faisy@gmail.com`, credentials from `~/.atlassian-login` (email/site)
and `~/.atlassian-api-token` via `FORGE_EMAIL` / `FORGE_API_TOKEN`.

| Element | Value |
|---|---|
| App | `Chantiers en collision` — id `ari:cloud:ecosystem::app/2ef208cc-6621-42a7-8557-5ce5ab3f6882` |
| Developer Space | `laddition` (`abf72fff-edaf-4259-900c-743702f0d1f2`) |
| Site | `one-atlas-cndz.atlassian.net` (free 90-day demo site) |
| Environment | `development` v2.0.x — deployed + installed (Jira) |
| `forge lint` | **No issues found** |
| Custom field | `Collisions` = `customfield_10870` (created via REST; also set as Forge variable `CHANTIERS_COLLISIONS_FIELD_ID`) |
| Web trigger (ingest) | `https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ` + route suffix (`/open`, `/touch`, `/close`, `/ci/footprint`, `/ci/conflict`) |
| MCP endpoint | `https://mcp.atlassian.com/forge/2ef208cc-6621-42a7-8557-5ce5ab3f6882` — answers 404 **until the external exposure is enabled** (manual admin step below) |
| Console | https://developer.atlassian.com/console/myapps/2ef208cc-6621-42a7-8557-5ce5ab3f6882 |

Commands actually run:

```bash
export FORGE_EMAIL=$(sed -n '1p' ~/.atlassian-login | sed 's/^email=//')
export FORGE_API_TOKEN=$(cat ~/.atlassian-api-token)

forge-atlassian create "Chantiers en collision" -t jira-issue-panel-ui-kit \
  -d /tmp/cc-mint -s abf72fff-edaf-4259-900c-743702f0d1f2 -y   # → app.id → manifest.yml
forge-atlassian lint                                            # No issues found
forge-atlassian deploy -e development --non-interactive --approve MAJOR_VERSION_RULE
forge-atlassian install -e development -p jira -s one-atlas-cndz.atlassian.net \
  --non-interactive --confirm-scopes
curl -s -u "$FORGE_EMAIL:$FORGE_API_TOKEN" -X POST \
  https://one-atlas-cndz.atlassian.net/rest/api/3/field \
  -H 'Content-Type: application/json' \
  -d '{"name":"Collisions","description":"Open collisions and worst degree (Chantiers en collision).","type":"com.atlassian.jira.plugin.system.customfieldtypes:textfield"}'
forge-atlassian variables set CHANTIERS_COLLISIONS_FIELD_ID customfield_10870 -e development
forge-atlassian webtrigger create -f ingest -s one-atlas-cndz.atlassian.net -p jira -e development
forge-atlassian deploy -e development --non-interactive        # apply variables
```

Verified live: `POST <webtrigger>/touch` without a token → **200 empty**
(fail-open, spec §22.11); invalid token on a hook route → 200 empty (an agent
is never blocked).

### Remaining manual steps (browser, ~5 min)

1. **External MCP exposure** (for Claude Code / Cursor): admin.atlassian.com →
   Apps → Sites → `one-atlas-cndz` → Connected apps → *Chantiers en collision*
   → enable the tools. Then the endpoint
   `https://mcp.atlassian.com/forge/2ef208cc-6621-42a7-8557-5ce5ab3f6882`
   answers 401 + OAuth 2.1 metadata instead of 404.
2. **Tokens**: ask the Rovo agent *Site foreman* (Rovo Chat on the site) to run
   `create-hook-token` (personal + project), or use any internal Rovo MCP
   client. The clear value is shown once.
3. Optional: `forge-atlassian deploy -e production` + install production for
   the submission (the Marketplace/judges usually get the production env).

### Known warnings (accepted)

- **UI Kit 1 deprecated** (issue panel, map, project settings, gadget): works,
  warns at deploy. Migration to UI Kit 2 (`@forge/react`) is backlog
  (docs/IDEAS.md). `jira:sprintAction` and `jira:personalSettingsPage` are
  Custom-UI-only in 2026 and are parked out of the manifest for now — sprint
  check stays reachable through `plan-parallel-work`/`list-collisions`, tokens
  through `create-hook-token`.
- **Runs on Atlassian**: not eligible while the web trigger is `dynamic`
  (it must return hook JSON). Expected.

### Live verification (12 November, ~15:00 Paris)

- `scripts/seed-jira-demo.py` — created project **PROJ** (software), components
  billing/database/auth/i18n, 7+1 real tickets; the `avi:jira:created:issue`
  trigger opened **planned** worksites (visible via `/status`); In-Progress
  transitions opened human worksites.
- CI route with the project token attested 4 branch footprints — including the
  **D4** on `db/migrations` (PROJ-3 × PROJ-4) shown by `/status`
  (`openCollisions: 2`).
- Agent route with the personal token: `/open` + `/touch` returned the spec §8
  verdict block (`caution · D2 · src/billing/invoice.ts · neighbour PROJ-1 ·
  PR open · wait for the merge · resume 15 min`).
- `templates/watcher/chantier-watch.mjs` verified live: editing a file in a
  scratch git repo printed the real verdict in the terminal (including the
  same-ticket/same-pilot flags).
- `scripts/smoke-e2e.sh` against the live web trigger: **SMOKE OK (8/8)**.
- CC-24: creating PROJ-8 (“Render invoice PDFs…”) triggered the prediction
  chain with the inferhub fallback armed (INFERHUB_* variables, key
  encrypted) — no error in `forge logs`.
- Bootstrap disarmed: `BOOTSTRAP_SECRET`/`BOOTSTRAP_ACCOUNT` unset (takes
  effect on the deploy that followed; `/bootstrap` is an empty 200 again).

### Two commands, not one — `forge deploy` is not enough

`forge deploy` uploads a **new version** of the app, but the **installation**
on the site keeps serving the version it was installed with. A new route (or
any code change) appears "not deployed" until:

```bash
forge-atlassian deploy -e development --non-interactive [--approve MAJOR_VERSION_RULE]
forge-atlassian install --upgrade -e development -p jira \
  -s one-atlas-cndz.atlassian.net --non-interactive --confirm-scopes
```

Symptoms of a missing upgrade: the old routes answer, the new ones return an
empty 200 (the web trigger is fail-open by design, so a missing route is
silent — `forge logs` shows nothing). Rule of thumb: **commit → deploy →
install --upgrade → test**.

Also: `forge deploy` packages the **committed** state (git HEAD), not the
working tree — uncommitted changes are not deployed.
