# Chantiers en collision

Forge app for Jira · **Codegeist 2026**, category *Apps for Software Teams* · MIT licence.

[![Live demo](https://img.shields.io/badge/live%20demo-Open%20the%20site-58a6ff)](https://baptistefaisy.github.io/chantiers-en-collision/)

> Jira knows, at every instant, who is working on which part of the code — people and agents
> alike. Every work in progress has a **footprint** on the repository. Every overlap is
> flagged **before the first line is written**, and the app says what to do: wait,
> coordinate, split, or run in parallel safely.
>
> — the one-line pitch (canonical FR + EN): **[`docs/PITCH.md`](docs/PITCH.md)**

## The live demo

**<https://baptistefaisy.github.io/chantiers-en-collision/>** — no install, no Jira, works on
mobile. The page runs the **real engine** compiled for the browser and reads the **real data of
the deployment** (`/demo/verdict`, `/demo/state`): the verdict a judge reads is the one the
deployed engine computed on the actual `acme/billing` worksites, refreshed every 10 s. If the
deployment is asleep the page says so and falls back to the same engine running locally. Page
source: [`site/index.html`](site/index.html).

The deployment runs on `one-atlas-cndz.atlassian.net` (development environment) with real data
(8 tickets, real D2/D4 collisions). Receipts of the last live run:
**[`docs/PROOFS.md`](docs/PROOFS.md)**.

## The 4 test paths

The site is the entry point; the step-by-step walkthrough is in
**[`docs/JUDGES.md`](docs/JUDGES.md)**.

1. **In Jira alone** — simulation console, worksite map, issue panel, Rovo agent.
2. **With an MCP client** — `declare-footprint` twice, two sessions, two verdicts.
3. **With the hook** — the example repository, your personal token, two agent sessions.
4. **Without installing anything** — two `curl` commands: a CI push makes an attested footprint
   appear.

## Develop

```bash
npm install
npm run verify      # lint + typecheck + manifest gate + tests
```

`npm run verify` is the whole local gate. To deploy: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Client integrations — one protocol, many doors

- **Claude Code**: native hooks (`.chantier/hook.sh`), see [`billing-demo`](https://github.com/BaptisteFaisy/billing-demo);
- **Any editor/agent** (Cursor, Aider, Copilot CLI, Codex…): [`templates/watcher/`](docs/WATCHER.md) — verified live against the deployed app;
- **OpenCode**: native plugin ([`templates/opencode/`](docs/OPENCODE.md));
- **CI** (GitHub Actions, GitLab CI, Bitbucket Pipelines): attested footprint at push time ([`templates/ci/`](templates/ci));
- **Any MCP client**: the 16 tools, over OAuth 2.1 once external exposure is enabled;
- **Agent fleets**: the local stdio [MCP bridge](docs/MCP-BRIDGE.md) — no OAuth, one `[[mcp.servers]]` entry.

## Architecture (short)

One Forge app installed on Jira. Agents talk to it over **Rovo MCP** (16 tools) and over one
**web trigger** (`ingest`: `/open`, `/touch`, `/close`, `/ci/footprint`, `/ci/conflict`); humans
through the **Jira UI** modules and a **Rovo agent**. Everything is persisted in **Forge SQL**
(14 tables, no foreign keys), two scheduled triggers do the housekeeping (dormancy and expiry
every five minutes, predictions and learning daily). Detail:
**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** · the agent protocol:
**[`docs/PROTOCOL.md`](docs/PROTOCOL.md)**.

## Companion repositories

- [`BaptisteFaisy/billing-demo`](https://github.com/BaptisteFaisy/billing-demo) — the sample repo judges clone (hook, CI step, `curl` scripts).
- [`BaptisteFaisy/open-footprint-protocol`](https://github.com/BaptisteFaisy/open-footprint-protocol) — the open protocol: any agent, any backend.

## All the documentation

**[`docs/INDEX.md`](docs/INDEX.md)** — one document, one audience, one role. The rest of the doc
lives there: product spec, architecture, contracts, deployment, judge paths, proofs, protocol,
video.

## Licence

MIT — see [LICENSE](LICENSE). Built for Codegeist 2026, category *Apps for Software Teams*.
