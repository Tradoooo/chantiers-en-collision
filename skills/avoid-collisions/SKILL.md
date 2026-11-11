---
name: avoid-collisions
description: Declare your footprint before editing, read the verdict, redeclare on drift, close your worksite when done. PLACEHOLDER created by workstream I so the rovo:skill module has a valid source directory — the real content is owned by workstream L and already drafted in templates/skill/SKILL.md.
---

# avoid-collisions (PLACEHOLDER)

> **Workstream I note — not the owner of this file.**
> `modules.rovo:skill[0].source.dir` must point at a directory that exists and
> contains a `SKILL.md` whose frontmatter `name` equals the directory name
> (manifest-reference/modules/rovo-skill). `templates/skill/SKILL.md` already
> holds the real protocol but its directory is named `skill`, so it cannot be
> referenced directly. The orchestrator (or workstream L) should MOVE that file
> here — `skills/avoid-collisions/SKILL.md` — and keep `templates/skill/` for
> the open-source publication, or delete one of the two.

The protocol, in five steps:

1. **Before writing anything**, call `declare-footprint` with your ticket and
   the paths you are about to touch (`paths` is ONE string, one path per line).
2. **Read the verdict** and act on it: `free` → go ahead; `caution` → read the
   neighbour worksite first; `wait` → work outside the zone or pick another
   ticket with `list-clear-work`; `stop` → the zone is reserved or frozen.
3. **Redeclare on drift** — same call, updated paths.
4. **Before a rename, a deletion or a signature change**, call `post-notice`.
5. **When done**, call `close-worksite`: it releases everyone waiting on you.
