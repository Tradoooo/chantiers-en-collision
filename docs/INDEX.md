# INDEX — the whole documentation, in one place

> One document, one audience, one role. If a fact exists in two documents, it is written
> only here and the others point to it. See [`docs/CONSOLIDATION.md`](CONSOLIDATION.md)
> for the consolidation plan (top 10).

## The entry point

| Document | Audience | Role |
|---|---|---|
| [`README.md`](../README.md) | everyone (30 s) | the way in: live demo, pitch in one line, the 4 test paths, dev commands |
| [`site/index.html`](../site/index.html) | judges (visiting) | the live demo: playground, real data of the deployment, “Four agents” scenario |
| [`docs/PITCH.md`](PITCH.md) | judges, video, Devpost | the pitch FR + EN, the single source |

## The product

| Document | Audience | Role |
|---|---|---|
| [`docs/SPEC.md`](SPEC.md) | product, judges | the specification (FR): what the app does, the degrees, the verdicts, the 28 requirements |
| [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) | dev, reviewer | how it is built: modules, footprint sources, hook, tables, Forge SQL limits |
| [`docs/CONTRACTS.md`](CONTRACTS.md) | dev | the module map and the ground rules, to read before writing a line |
| [`docs/IDEAS.md`](IDEAS.md) | contributors | the backlog: 100 ideas, feature freeze on 15 December |

## The judges

| Document | Audience | Role |
|---|---|---|
| [`docs/JUDGES.md`](JUDGES.md) | judges | the entry point and the 4 test paths, step by step |
| [`docs/PROOFS.md`](PROOFS.md) | judges, reviewer | the receipts of the last live run (15/15) |

## Running it

| Document | Audience | Role |
|---|---|---|
| [`docs/DEPLOY.md`](DEPLOY.md) | deployer (me) | the first-time runbook: Forge CLI, tokens, smoke, installation |
| [`docs/MCP-BRIDGE.md`](MCP-BRIDGE.md) | agent, fleet | the local MCP bridge (stdio): 16 tools without OAuth |
| [`docs/OPENCODE.md`](OPENCODE.md) | agent | the native OpenCode plugin |
| [`docs/WATCHER.md`](WATCHER.md) | dev without a hook | `chantier-watch`: makes any editor or agent visible |

## The story

| Document | Audience | Role |
|---|---|---|
| [`docs/PROTOCOL.md`](PROTOCOL.md) | agent authors | the agent protocol: declare, read the verdict, notify, close |
| [`docs/VIDEO-SCRIPT.md`](VIDEO-SCRIPT.md) | video editor | the storyboard of the submission screencast (< 5 min, EN) |
| [`docs/CONSOLIDATION.md`](CONSOLIDATION.md) | the team | the consolidation plan: what comes first, and why |
| [`docs/CONSOLIDATION-V2.md`](CONSOLIDATION-V2.md) | the team | consolidation, wave 2: the 10 next moves after wave 1 landed |

## Sub-folders

| Path | Contents |
|---|---|
| `docs/consolidation/` | the 999 consolidation ideas, the TSV dataset, the stats |
| `docs/consolidation/data/v2/` | wave 2: 100 more consolidation ideas (TSV, shortlist, stats) |
| `docs/consolidation/IDEES-1000-{1,2,3}.md` | the raw ideas, grouped by family |

## House rule

One fact = one place. If you write a fact that already exists, replace it with a link.
