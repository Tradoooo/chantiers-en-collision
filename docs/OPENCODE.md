# OPENCODE — the native OpenCode plugin

`templates/opencode/` is the native integration for **OpenCode** (the coding
agent, v2 API — tested on `opencode 2.1.1`). It makes an OpenCode session
visible to the app and, in hard mode, able to be stopped by it: the worksite
opens with the session, every file about to be written is declared before the
write, and the worksite closes when the server shuts down.

It speaks the same `ingest` web trigger as the Claude Code hook and the
watcher: `POST /open`, `/touch`, `/close`, `Authorization: Bearer`,
`X-Chantier-Repo`. **Only paths are sent — never file content.**

Full instructions: [`templates/opencode/README.md`](../templates/opencode/README.md).

## How it hooks OpenCode

OpenCode v2 plugins are a default export `{ id, setup(ctx) }`. The plugin uses
four real hooks of that API:

| OpenCode API | Used for |
|---|---|
| `ctx.event.subscribe({types:["session.execution.started","location.shutdown"]})` | open the worksite, close it |
| `ctx.tool.hook("execute.before", …)` | declare the file a write tool is about to touch |
| `ctx.permission.hook("evaluate", …)` | **refuse** the write when the app answers `deny` |
| `ctx.session.hook("context", …)` | inject the app's verdict in the agent's context |

The permission hook is the only place OpenCode lets a plugin block an action:
the plugin sets `event.effect = "deny"` and `event.message`, the tool call is
rejected with the app's reason, and the agent reads it. Everything else is
advice. It is **fail-open**: 3 s timeout (1.5 s for `/close`), any error is
swallowed, the agent continues.

## Install (short)

```bash
mkdir -p .opencode/chantiers
cp templates/opencode/chantiers.mjs     .opencode/chantiers/index.js
cp templates/opencode/chantiers-lib.mjs .opencode/chantiers/chantiers-lib.mjs
export CHANTIER_URL="https://<host>.webtrigger.atlassian.app/public/<id>"
export CHANTIER_TOKEN="<personal token>"
export CHANTIER_REPO="acme/billing"
```

plus one line in `opencode.json`: `"plugins": [{ "package": "./.opencode/chantiers" }]`.
Auto-discovery (`.opencode/plugins/chantiers.js`) and a global install
(`~/.config/opencode/plugins/`) also work — see the template README.

## The three routes, and when to use which

| | Native plugin (OpenCode) | Native hook (Claude Code) | Watcher | MCP |
|---|---|---|---|---|
| Sees | tool events of the agent | `PreToolUse` events | file writes on disk | the agent's own calls |
| Feedback | agent context + stderr | injected in the conversation | stdout only | the MCP answer |
| Blocks? | yes (permission hook) | yes | no | the agent decides |
| Client | OpenCode ≥ 2 | Claude Code | any editor or agent | any MCP client |

The watcher stays the portable answer where there is no hook; the MCP server
is how an agent *negotiates* (declare a footprint, read a neighbour, post a
notice) instead of being observed.

## Limitations

- Shell writes are not tracked (no path in a `bash` call): an agent refused a
  file can still write it through the shell. CI remains the attested source of
  the merged footprint.
- One session reference per plugin process: all the chats of one OpenCode
  server share a worksite unless `CHANTIER_SESSION` is set.
- OpenCode v2 has no session-end event: `/close` goes out on server shutdown
  and plugin unload; the app's dormancy closes the rest.
- OpenCode 1.x is not supported — use the watcher there.
