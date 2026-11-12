# MCP-BRIDGE — the local MCP bridge (agent fleets, inferhub)

`templates/mcp-bridge/` is a **local MCP server (stdio)** that bridges to the
deployed app over the ingest web trigger's `/tool` route. It lets **any MCP
client** call the app's 16 tools with a personal hook token — no Atlassian
OAuth dance, no per-client integration:

- the **ZeroClaw agent fleet** (the agents served by the inferhub gateway),
- Claude Code, Cursor, or any MCP-capable client.

The bridge sends **nothing but the tool name and its arguments**; the app
answers with its usual verdict block (spec §8). Identity comes from the token,
never from the arguments (spec §9.6).

## Run it

```bash
export CHANTIER_URL="https://<installation>.webtrigger.atlassian.app/public/<key>"
export CHANTIER_TOKEN="<personal token>"     # shown once, at creation
export CHANTIER_REPO="acme/billing"          # default repo for the payloads

node templates/mcp-bridge/mcp-bridge.mjs      # speaks MCP on stdio
```

## Plug it into ZeroClaw (the inferhub fleet)

`~/.zeroclaw/config.toml`, in the existing `[[mcp.servers]]` section:

```toml
[[mcp.servers]]
name = "chantiers"
command = "node"
args = ["/home/baptiste/Bureau/chantiers-en-collision/templates/mcp-bridge/mcp-bridge.mjs"]
env = { CHANTIER_URL = "https://…", CHANTIER_TOKEN = "…", CHANTIER_REPO = "acme/billing" }
```

Then any agent of the fleet can call `declare-footprint`, `check-zone`,
`next-clear-ticket`, `plan-parallel-work`… before touching a file.
(The fleet config is **not** modified by the repo: one entry there applies to
every agent of every project.)

## Plug it into Claude Code / Cursor

Claude Code and Cursor read MCP servers from their own config; point them at
the same command and environment. The app's own remote MCP server
(`https://mcp.atlassian.com/forge/<appId>`) also works, but it needs the
external exposure to be enabled by an Atlassian admin — the bridge does not.

## How it works

1. `bridge-lib.mjs` — pure core: the tool catalog (mirrors `manifest.yml`)
   and the JSON-RPC handling (`initialize`, `tools/list`, `tools/call`).
2. `mcp-bridge.mjs` — the transport: newline-delimited JSON-RPC on stdin,
   answers on stdout, diagnostics on stderr, calls `POST <BASE>/tool` with the
   Bearer token.
3. The app's `/tool` route (webtrigger) — token-gated, identity from the
   token, project tokens limited to read-only tools.

Fail-soft everywhere: a network error becomes an MCP error content, never a
crash of the agent.

## Verify it against the deployment

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check-zone","arguments":{"paths":"src/billing/invoice.ts"}}}' \
| CHANTIER_URL="$CHANTIER_URL" CHANTIER_TOKEN="$CHANTIER_TOKEN" \
  CHANTIER_REPO="acme/billing" node templates/mcp-bridge/mcp-bridge.mjs
```

Expected: the initialize handshake, then the app's real verdict for that path
(`free`, `caution`, `wait` or `stop`, with the neighbour and the path).

Tests: `tests/templates/mcp-bridge.test.ts` (JSON-RPC, catalog, repo
injection, error shaping) and `tests/glue/tool-route.test.ts` (scope rules,
identity from the token).
