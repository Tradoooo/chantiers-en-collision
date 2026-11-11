---
name: avoid-collisions
description: Declare your footprint before editing, read the verdict, redeclare on drift. Use this skill whenever you are about to modify files in a repository shared with other developers or agents — it tells you who else is on those paths, whether you may proceed, and what to do instead when you may not.
---

# avoid-collisions

Other people and other agents are working in this repository right now. Worktrees isolate files,
not intentions. This skill makes you visible and tells you, before you write a line, whether the
paths you want are free.

You need the `chantiers-mcp` tools (a Forge app installed on Jira): `declare-footprint`,
`check-zone`, `list-clear-work`, `post-notice`, `close-worksite`. All inputs are simple values —
`paths` is **one string, one path per line**.

## The protocol — five steps

1. **Before writing anything**, call `declare-footprint` with your ticket and the paths you are
   about to touch.
2. **Read the verdict** and act on it:
   - `free` → go ahead.
   - `caution` → read the neighbour worksite first (its PR, its paths, its notice), then continue.
   - `wait` → work outside that zone, or pick another ticket with `list-clear-work`.
   - `stop` → the zone is reserved or frozen (hard mode). Do not touch it.
3. **If your work drifts outside what you declared, redeclare.** Same call, updated paths.
4. **Before a rename, a deletion or a signature change**, call `post-notice` on the affected paths.
5. **When you are done**, call `close-worksite`. It releases everyone waiting on you.

## Calls, with exact inputs

### Declare before editing

```jsonc
// declare-footprint
{
  "issueKey": "PROJ-101",
  "repo": "acme/billing",
  "paths": "src/billing/invoice.ts\nsrc/billing/tax.ts",
  "mode": "edit",           // edit (default) | create | delete | rename
  "etaMinutes": 45,
  "session": "sess-101-a"   // distinguishes your sessions; grants no right
}
```

Response — a verdict, every collision, the neighbour's name and what to do:

```text
verdict: caution
collision: D2 · ordinary
neighbor: PROJ-88 · agent of Léa (session 3f2a) · PR open · active 4 min ago
reason: same file touched by two worksites
neighbor's notice: "renaming invoices.total to total_cents"
what to do: read the neighbor worksite before editing this file
```

Read that notice and adapt (`total` → `total_cents`) instead of writing the old name back.

### Check without declaring

```jsonc
// check-zone
{ "repo": "acme/billing", "paths": "db/migrations/", "issueKey": "PROJ-101" }
```

Use it before committing to an approach: it returns the same verdict shape and declares nothing.

### Waiting? Find work that is actually free

```jsonc
// list-clear-work
{ "jql": "project = PROJ AND status = 'To Do' ORDER BY priority DESC", "session": "sess-101-a" }
```

Returns ready tickets nobody collides with. Take the first one and declare it.

### Warn your neighbours before a breaking change

```jsonc
// post-notice
{
  "issueKey": "PROJ-101",
  "paths": "src/billing/invoice.ts\nsrc/shared/money.ts",
  "text": "renaming invoices.total to total_cents; callers must be updated in the same PR"
}
```

Delivered **once** per neighbour session, with their next tool response or their next hooked edit.
Keep it short and factual: what changes, where, when.

### Close when done

```jsonc
// close-worksite
{ "issueKey": "PROJ-101", "session": "sess-101-a", "outcome": "merged" }  // merged | abandoned | done
```

## Rules of conduct

- **Never write before declaring.** One call, under two seconds, before the first edit.
- **Redeclare on drift, always.** A rename pulls in the callers; a refactor pulls in the folder.
  If the hook tells you a file is outside your declaration, redeclare immediately — the app has
  already widened your observed footprint and noted the gap.
- **Post a notice before any rename, deletion, move or signature change.** The people you break
  are usually the ones you cannot see.
- **An agent that waits does not loop.** On `wait` or `stop`: do not poll, do not retry the same
  declaration, do not sleep and re-check. Switch to another ticket via `list-clear-work`, or stop
  and state what you are waiting for. The pilot is notified on release and your next call answers
  `free`.
- **A collision is not an error to route around.** Use the six ways out — wait, sequence,
  coordinate, split, merge, override — via `resolve-collision` with the `collisionId` from the
  verdict. `override` requires a reason and is measured afterwards against real conflicts.
- **Reservations are for seconds-scale exclusivity**, not for parking a zone: 2 h default, 24 h
  max, and they always expire. Prefer a notice plus a redeclaration.
- **Never pass someone else's session id or ticket key.** Identity comes from your token or the
  call context; a `session` value only tells your own sessions apart.
- **Close your worksite even when you abandon the work.** A ghost worksite blocks your neighbours
  for up to seven days until dormancy closes it.

## Degrees, for reading a verdict

| Degree | Situation | Verdict |
|---|---|---|
| D0 | same zone, different files | `free` |
| D1 | same folder | `caution` |
| D2 | same file | `caution` — read the neighbour first |
| D3 | same file, deleted / moved / renamed by one side | `wait` or coordinate |
| D4 | exclusive resource, reserved or frozen zone | `wait`; `stop` in hard mode |
| D5 | broken contract, no common file | coordinate |

Lowered one notch in a hotspot (routes, translations) or when the neighbour is dormant. Capped at
D1 and tagged `probable` when only a prediction is involved. Two agents of the same pilot get no
discount — that case is tagged `your two agents`.
