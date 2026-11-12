# Chantiers en collision — OpenCode plugin

`templates/opencode/` makes an **OpenCode** session visible to the
*Chantiers en collision* app (Jira Forge): the worksite opens when the
session starts, every file the agent is about to write is declared, and the
worksite is closed when the session ends.

The plugin speaks the app's `ingest` web trigger (`/open`, `/touch`, `/close`),
the same contract as the native Claude Code hook and the generic watcher.

- Tested against **opencode 2.1.1** (`opencode --version`).
- Zero dependency: plain ESM JavaScript, `node:` built-ins only.
- **Fail-open**: every call has a 3 s timeout, every error is swallowed, and
  the agent is never blocked except by an explicit `deny` from the app.

## Install

### A. Per project, with options (recommended)

```bash
mkdir -p .opencode/chantiers
cp templates/opencode/chantiers.mjs      .opencode/chantiers/index.js
cp templates/opencode/chantiers-lib.mjs  .opencode/chantiers/chantiers-lib.mjs
```

```jsonc
// opencode.json (project root)
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "./.opencode/chantiers" }]
}
```

The plugin is then loaded for every session of that project. `index.js` is the
entry point OpenCode looks for in a plugin directory; the two files must stay
side by side (the plugin imports `./chantiers-lib.mjs`).

### B. Per project, auto-discovered (env only, no config entry)

```bash
mkdir -p .opencode/plugins
cp templates/opencode/chantiers.mjs      .opencode/plugins/chantiers.js
cp templates/opencode/chantiers-lib.mjs  .opencode/plugins/chantiers-lib.mjs
```

OpenCode loads every `.js`/`.ts` file of `.opencode/plugins/` automatically.
Note: `.mjs` files are **not** discovered — that is why the file is copied
under a `.js` name.

### C. Global, for every project of the machine

```bash
mkdir -p ~/.config/opencode/plugins
cp templates/opencode/chantiers.mjs      ~/.config/opencode/plugins/chantiers.js
cp templates/opencode/chantiers-lib.mjs  ~/.config/opencode/plugins/chantiers-lib.mjs
```

The global plugin is loaded by every project; the repo slug then has to come
from `CHANTIER_REPO` (the plugin cannot guess the project).

## Configuration

Environment variables win over the plugin `options`, options win over the
defaults.

| Variable | Default | Meaning |
|---|---|---|
| `CHANTIER_URL` | — | base web-trigger URL, **without** the route (required) |
| `CHANTIER_TOKEN` | — | personal Bearer token (required; identity = the token) |
| `CHANTIER_REPO` | — | repo slug, e.g. `acme/billing` (sent as `X-Chantier-Repo`) |
| `CHANTIER_SESSION` | one per plugin process | session reference |

```bash
export CHANTIER_URL="https://<host>.webtrigger.atlassian.app/public/<token>"
export CHANTIER_TOKEN="<personal token>"   # never committed
export CHANTIER_REPO="acme/billing"
```

The same values can be given as plugin options (`url`, `token`, `repo`,
`session`) — `templates/opencode/opencode.json` shows the
`{env:CHANTIER_URL}` substitution.

## What is sent

Only **paths**. No file content, no diff, no patch ever leaves the machine.

| Route | When | Body |
|---|---|---|
| `/open` | session start (`session.execution.started`) or before the first write | `{sessionRef, branch, cwd}` |
| `/touch` | before a write tool (`write`, `edit`, `multiedit`, `patch`) | `{session_id, tool_input:{file_path}, cwd, hook_event_name:"PreToolUse"}` |
| `/close` | server shutdown (`location.shutdown`) and plugin unload | `{sessionRef, reason}` |

Headers: `Authorization: Bearer <token>` and `X-Chantier-Repo: <slug>`.

The branch is read with `git rev-parse --abbrev-ref HEAD` in the project
directory of the session; the ticket key (`PROJ-123`) is read from it by the
app.

## What the agent sees

The app answers with the hook JSON. The plugin turns it into:

- **`additionalContext`** → printed on stderr with the `[chantier]` prefix
  **and injected into the agent's context** (the OpenCode `context` session
  hook), so the agent itself reads the verdict of the app.
- **`permissionDecision: "deny"`** → the write is **refused**: the plugin sets
  `effect = "deny"` in the OpenCode permission hook, the tool call is rejected
  with the app's reason, and the agent sees it:

  ```text
  ✗ Write src/db/migrations/0043_x.sql failed
  Error: zone frozen by PROJ-88
  ```

  Deny only exists when the project runs the app in hard mode; otherwise the
  app answers with advice only.

## The three routes to the app

| | OpenCode plugin (this one) | Generic watcher (`templates/watcher`) | MCP (`opencode.json` → `mcp.servers`) |
|---|---|---|---|
| What it sees | the agent's **tool events** | **file writes** on disk, whoever makes them | the agent's **explicit calls** |
| What it sends | `/open` `/touch` `/close` | `/open` `/touch` `/close` | `declare-footprint`, `check-zone`, … |
| Feedback | injected in the agent's context + stderr | stdout only | the MCP answer, in the conversation |
| Can it block? | **yes** (permission hook, hard mode) | no | the agent decides |
| Install | 2 files + `opencode.json` | 1 script, run beside the agent | config + Atlassian OAuth |
| Works with | OpenCode ≥ 2 | any client (Cursor, Aider, Codex, vim…) | any MCP client |

**Which one?**

- **OpenCode** → use this plugin: it is the only route that sees the agent
  *before* the write and can refuse it.
- **Another client** (or a human editing in the same worktree) → use the
  watcher: it observes the files, whatever wrote them.
- **An agent that must negotiate** (read the neighbour's PR, post a notice,
  declare a footprint itself) → use the MCP server: the agent drives the
  protocol of `docs/PROTOCOL.md` step by step.

They compose: the plugin (or the watcher) tells the app *what* is being
written, the MCP server lets the agent *talk* about it.

## Verify

```bash
# 1. the plugin loads and talks to the app (stderr)
CHANTIER_URL=… CHANTIER_TOKEN=… CHANTIER_REPO=acme/billing \
  opencode run --print-logs -m <provider/model> "reply ok" 2>&1 | grep '\[chantier\]'
# → [chantier] enabled — session oc-host-1234-abcdef on /path/to/project

# 2. the app answers the touch route
curl -s -X POST "$CHANTIER_URL/touch" \
  -H "Authorization: Bearer $CHANTIER_TOKEN" \
  -H "X-Chantier-Repo: acme/billing" -H 'content-type: application/json' \
  -d '{"session_id":"check","tool_input":{"file_path":"probe.txt"},"cwd":"/tmp","hook_event_name":"PreToolUse"}'
```

`templates/opencode/opencode.json` also declares the remote Forge MCP server
(`https://mcp.atlassian.com/forge/2ef208cc-…`). OpenCode handles the OAuth
flow itself (`opencode mcp auth`); the app must have its **external
exposure** enabled by an Atlassian admin before the server is reachable.

## Limitations

- **Shell writes are not tracked.** The contract has no path for a `bash`
  command, so an agent blocked on a file can still write it through the shell.
  Same limitation as the watcher; CI stays the attested source of the merged
  footprint.
- **One session per plugin process.** Every chat of an OpenCode server shares
  the same worksite unless `CHANTIER_SESSION` is set per session.
- **No "session end" event in OpenCode v2.** `/close` is sent when the server
  shuts down and when the plugin unloads; in between, the app's own dormancy
  (idle worksites) closes the session.
- **OpenCode v2 only.** On opencode 1.x use the watcher instead.
- The plugin is **not** a package: it is two files you copy. It never
  installs anything and never writes outside your project.
