# The agent protocol

This is the contract between a coding agent and the app. It is published three ways, with the
same content: as this document, as a Rovo skill (`prompts/avoid-collisions.md`), and as a
standalone skill file any client can read (`templates/skill/SKILL.md`).

The protocol is five steps. Everything else in the app exists to make those five steps cheap.

## 1. The five steps (spec §9.2)

1. **Before writing anything, call `declare-footprint`** with the ticket and the paths you are
   about to touch. One path per line. Say the mode (`edit`, `create`, `delete`, `rename`) and, if
   you know it, the ETA in minutes. (`check-zone` returns the same verdict without declaring
   anything — use it while you are still weighing two approaches.)
2. **Read the verdict.**
   - `free` → go ahead. A neighbour may still be named: same zone, different files. Nothing to do.
   - `caution` → read the neighbour worksite (its PR, its declared paths, its notice), then
     continue. Do not edit blind.
   - `wait` → work outside that zone, or ask for another ticket with `list-clear-work`.
   - `stop` → hard mode: the zone is reserved or frozen. Do not touch it. Work elsewhere.
3. **If the work drifts outside what you announced, redeclare.** A rename pulls in the callers; a
   refactor pulls in the folder. Redeclaring costs one call; staying silent costs a merge
   conflict resolved by an agent that does not know your intent.
4. **Before a rename, a deletion or a signature change, post a notice** (`post-notice`): a short
   message on the paths concerned. It reaches the neighbours once, with their next tool response
   or their next hooked edit — the only way to talk to an agent mid-work without interrupting its
   pilot.
5. **At the end, call `close-worksite`** (`merged`, `abandoned` or `done`). It releases everyone
   waiting on you.

**An agent waiting does not loop.** If the verdict is `wait` or `stop`, do not poll, do not retry
the same declaration, do not sleep-and-recheck. Either switch to another ticket (`list-clear-work`
returns ready work nobody collides with), or stop and state plainly what you are waiting for and
what will unblock you. The app notifies the pilot when the zone frees up, and your next call
answers `free`.

## 2. What a verdict looks like (spec §8)

Exact example from the spec (French, verbatim):

```text
verdict : attendre
collision : D4 · ressource exclusive « migrations »
voisin : PROJ-88 · agent de Léa (session 3f2a) · PR ouverte · actif il y a 4 min
raison : une seule migration à la fois
avis du voisin : « je renomme invoices.total en total_cents »
à faire : continuer hors de db/migrations/, puis redéclarer après la fusion de PROJ-88
reprise estimée : 25 min
```

Same verdict as the app renders it in English (`src/i18n/en.ts`):

```text
verdict: wait
collision: D4 · exclusive resource "migrations"
neighbor: PROJ-88 · agent of Léa (session 3f2a) · PR open · active 4 min ago
reason: one worksite at a time in exclusive zone "migrations"
neighbor's notice: "renaming invoices.total to total_cents"
what to do: keep working outside db/migrations/, then redeclare your footprint after PROJ-88 merges
estimated resume: 25 min
```

**No verdict without a named neighbour, a cited path and a course of action.** If you receive a
warning that names nobody, that is a bug — report it, do not work around it.

The machine-readable shape is the same information:

```jsonc
{
  "kind": "wait",                       // free | caution | wait | stop
  "collisions": [{
    "collisionId": "col_01H…",          // for resolve-collision
    "degree": 4,                        // 0..5
    "zoneName": "migrations",
    "zoneNature": "exclusive",          // ordinary | exclusive | hotspot | frozen | out-of-scope
    "path": "db/migrations/0043_x.sql",
    "neighbor": {
      "worksiteId": "ws_01H…",
      "issueKey": "PROJ-88",
      "actorLabel": "agent of Léa (session 3f2a)",
      "kind": "agent",
      "state": "review",                // planned|open|active|paused|review|dormant|closed
      "prOpen": true,
      "lastActivityAt": "2026-11-11T14:56:00.000Z"
    },
    "reason": "one worksite at a time in exclusive zone \"migrations\"",
    "advice": "keep working outside db/migrations/, then redeclare",
    "estimatedResumeMinutes": 25,
    "sameTicket": false,
    "samePilot": false
  }],
  "pendingNotices": [ /* delivered once, with this response */ ],
  "text": "verdict: wait\ncollision: D4 · …"
}
```

## 3. Degrees, in one table (spec §7)

| Degree | Situation | Verdict | What you do |
|---|---|---|---|
| D0 | same named zone, different files | `free` | go ahead; the neighbour is mentioned for awareness |
| D1 | same folder | `caution` | read the neighbour, then continue |
| D2 | same file | `caution` | read the neighbour worksite **before** editing that file |
| D3 | same file, one side deletes / moves / renames it | `wait` | work outside, or coordinate (`post-notice` + `resolve-collision`) |
| D4 | exclusive resource, reserved zone, frozen zone | `wait` (`stop` in hard mode) | work outside the zone; redeclare after release |
| D5 | broken contract, no common file (lot C) | coordinate | agree on the interface change before either side lands it |

Modulations you will see reflected in the degree: **hotspot** −1 (overlap is normal in routes and
translation files); **dormant neighbour** −1; **prediction-only** footprint caps at D1 and is
tagged `probable`; a neighbour whose **PR is open and approved** gets "wait for the merge, it is
close" instead of a plain wait.

**Same pilot, no discount.** Two of your own agents colliding is reported at full degree, tagged
`your two agents`. It is the most frequent and most expensive case; only the alert routing changes
(one pilot to warn instead of two).

## 4. Six ways out of a collision (spec §8)

`resolve-collision` takes the `collisionId` from the verdict and one of:

| Choice | What happens |
|---|---|
| `wait` | Your worksite joins the zone's queue. On release, the pilot is notified and your next call answers `free`. |
| `sequence` | An order is fixed: A merges, B rebases. The app sets a "is blocked by" link between the tickets and tells B which branch to read. |
| `coordinate` | A notice goes to the neighbour; both pilots are mentioned on a common thread. |
| `split` | The shared part (a rename, typically) moves to its own ticket, done first. The app drafts it. |
| `merge` | Same file, same purpose: one worksite does both. |
| `override` | Requires a reason. The app then watches whether a real conflict follows — it measures its own misses. |

**Who yields** (default order, configurable per project): an active reservation → a ticket linked
to an open incident, then ticket priority → the nearest due date → the most advanced worksite (PR
open, then in progress, then merely declared) → first come. On a tie, the agent yields to the
human: waiting costs it less. The setting can be inverted.

## 5. Three kinds of agent collisions (spec §9.1)

| Case | Example | Who is notified |
|---|---|---|
| Agents of the same pilot | four sessions started in parallel by one person | that pilot, **once** |
| Agents of different pilots | Léa's agent and Karim's agent on billing | both pilots |
| Agent and human | an agent enters a file whose PR is under review | the pilot **and** the PR author |

Sub-agents started by an agent are a fourth case: they share a ticket and get in each other's way.
Each one receives a sub-worksite (lot S), opened by the `SubagentStart` hook, with its neighbours
injected into its context.

## 6. Identity of an agent (spec §9.6)

An agent is identified by three things: **its pilot's account, its client, its session**.

- **Over MCP**, the account comes from the call context (OAuth). The `session` input is something
  the agent supplies: it serves to **distinguish** sessions, and never to grant a right. You cannot
  declare as someone else by passing their session id.
- **Over the hook**, the account comes from the **personal token**; the session — and, for a
  sub-agent, its identifier — come from the client event (`session_id`, `agent_id`, `agent_type`).

An agent is always attached to the person driving it. There is no anonymous worksite: a branch
with no ticket key still opens a worksite, attached to the pilot and the branch, and the personal
panel offers to link it to a ticket.

## 7. What the app never does

- It never stores file **content** — only paths. The hook endpoint discards everything but path,
  session and working directory before processing or storage.
- It never blocks by default. Fail-open: no answer in 3 s, the agent continues. Only hard mode,
  enabled by the project for its reserved and frozen zones, refuses an edit.
- It never lets a claim live forever: reservations expire (2 h default, 24 h max), idle worksites
  go dormant then close themselves.
- It never sends the same warning twice to the same session, and never one alert per file — one
  alert per collision.
