# WATCHER — the universal local watcher (`chantier-watch`)

`templates/watcher/chantier-watch.mjs` is a dependency-free Node ≥ 18 script
that makes **any** agent or editor visible to the app — no native hook, no
client integration. It watches a worktree for file writes and reports them to
the app's `ingest` web trigger (`/open`, `/touch`, `/close`), exactly like the
Claude Code hook, but from the filesystem instead of the client.

## Why

The native hook (`templates/hook/hook.sh`) only exists where a client supports
hooks. SPEC §19 lists as an open question *"équivalent des hooks dans les autres
clients"* — portability beyond Claude Code. The watcher answers it (IDEAS #6,
#26): a single script, zero editor integration, works for Cursor, Aider,
Copilot CLI, Codex, vim, or plain shell scripts. The trade-off is that it
observes *files* rather than *tool events*, so it sees writes from any source,
and it can only print advice to stdout instead of injecting context.

## How it works

On start it POSTs `/open` (`{sessionRef, branch, cwd}`), then watches the tree.
Every *stabilised* file write (debounced per file) POSTs `/touch`
(`{session_id, tool_input:{file_path}, cwd, hook_event_name:"PreToolUse"}`).
The response — `hookSpecificOutput.additionalContext` or a hard-mode
`permissionDecision: "deny"` — is printed on stdout with a `[chantier]` prefix:
it is the feedback for the human or agent watching the terminal. On SIGINT /
SIGTERM it POSTs `/close` and exits 0.

The watcher is **passive and fail-open** (SPEC §20): a 10 s fetch timeout with one retry
(1.5 s for `/close`) — the web trigger can cold-start beyond 3 s, so the budget lives in
`templates/chantiers-lib/payload.mjs` (`FETCH_TIMEOUT_MS`, `CLOSE_TIMEOUT_MS`), shared with
the OpenCode plugin. Any error is
for close), any network or JSON error is logged and swallowed, it never crashes
and never blocks the write it observes. Identity comes from the Bearer token;
the repo travels in the `X-Chantier-Repo` header. `.git`, `node_modules`,
`dist` and `.chantier` are ignored.

## Install

The watcher imports the shared payload builder (`templates/chantiers-lib/payload.mjs` —
the one place the shape of an emprise is written down, also used by the OpenCode
plugin): keep the two files in the same layout.

```bash
mkdir -p ~/bin/chantiers/chantiers-lib
cp templates/watcher/chantier-watch.mjs ~/bin/chantiers/chantier-watch
cp templates/chantiers-lib/payload.mjs   ~/bin/chantiers/chantiers-lib/payload.mjs
chmod +x ~/bin/chantiers/chantier-watch
export CHANTIER_URL="https://ecf6c663-f8a9-4232-b725-07cf87121ef4.webtrigger.atlassian.app/public/CMqSJpepH37pD_ux7w8m_3P7BEQ"
export CHANTIER_TOKEN="<personal token>"   # stays on your machine, never committed
chantier-watch                             # run inside the repo worktree
```

| Variable | Default | Meaning |
|---|---|---|
| `CHANTIER_URL` | — | base web-trigger URL, without the route (**required**) |
| `CHANTIER_TOKEN` | — | personal Bearer token (**required**) |
| `CHANTIER_REPO` | from `git remote get-url origin` | repo slug, e.g. `acme/billing` |
| `CHANTIER_SESSION` | `hostname-pid-random` | session reference (one per watch process) |
| `CHANTIER_WATCH_DIR` | cwd | directory to watch |
| `CHANTIER_DEBOUNCE_MS` | `2000` | debounce per file, ms |

## Recipes per client

**Cursor (task)** — run the watcher as a `background` task in a shell session
or terminal; it keeps the worktree visible while you edit.

**Aider** — wrap the command so the watcher starts and stops with the session:

```bash
alias aider-watch='( chantier-watch & W=$!; trap "kill -INT $W" EXIT; exec aider "$@" )'
```

**tmux split** — one pane, always on:

```bash
tmux split-window -h -l 30 "chantier-watch"
```

**systemd user unit** — one daemon per worktree (edit `WorkingDirectory`):

```ini
# ~/.config/systemd/user/chantier@.service
[Unit]
Description=Chantiers en collision watcher for %i
[Service]
ExecStart=%h/bin/chantier-watch
WorkingDirectory=%i
Environment=CHANTIER_URL=...
Environment=CHANTIER_TOKEN=...
[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now chantier@/path/to/worktree.service
```

## Comparison with the native hook

| | Native hook (`hook.sh`) | Watcher (`chantier-watch.mjs`) |
|---|---|---|
| Where it runs | inside the client (Claude Code) | beside any client, as a process |
| What it sees | `PreToolUse` events (path, session, cwd) | file writes (path, cwd) |
| Feedback | injected into the conversation | printed on stdout (`[chantier]`) |
| Filtering | client filters tools → paths | `.git`/`node_modules`/`dist`/`.chantier` ignored |
| Coverage | writes through the client only | writes from *any* tool or script |

The native hook stays **preferred on Claude Code**: its `additionalContext` is
injected straight into the conversation the agent is reading. The watcher holds
no such lever — it can only print to a terminal. Use it where there is no hook,
or to catch writes a hook would miss.

## Limitations

* **Shell / non-filtered writes.** Any write through `sed -i`, generators, or a
  plain editor reaches the watcher, but it reports a file-path only — no diff
  content ever leaves the machine. CI remains the **attested** source of the
  merged footprint (SPEC §19): the watcher observes, it does not authorise.
* **Passive advice.** The watcher never blocks a write; only the app can refuse
  an edit, and only in hard mode. Its stdout is useful only if someone looks.
* **Event granularity.** Debut wants 2 s of quiet before a file is reported;
  rapid successive saves are coalesced.

## Self-test

No installation, no network:

```bash
node templates/watcher/chantier-watch.mjs --selftest
# SELFTEST OK
```

It starts an ephemeral HTTP server, `git init`-s a temporary repo, runs a real
child watcher on it, touches a file, and verifies `/open` then `/touch` (and
`/close` on shutdown) were received with the right fields.