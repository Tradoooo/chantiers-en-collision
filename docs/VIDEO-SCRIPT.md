# Video script — sub­mis­sion screencast (English, < 5 min)

Storyboard: `docs/SPEC.md` §23. The whole film runs on the **real, deployed**
Forge app. Until that site exists, the browser demo at
**https://baptistefaisy.github.io/chantiers-en-collision/** is a drop-in visual
for any map / verdict / four-agents shot: it runs the same engine and both the
playground and the "Four agents" scenario replay live.

Format per shot: **VISUAL** (what is on screen), **NARRATION** (word for word,
calm voice, short sentences), **CAPTION** (on-screen text), **DURATION**.

---

## 0:00 – 0:35 · The problem (4 worktrees, one broken merge)

**VISUAL** — Split screen: four terminal windows, each a `git worktree`.
A green "✔ CLAUDE CODE" line sits at the top of each. Then the terminals fade and
one `git merge` transcript fills the screen: `CONFLICT — db/migrations/0042_*.sql`,
`renamed: checkout->orders-invoice`, `both modified: package-lock.json`.

**NARRATION**
> "One developer. Four agents. Four working copies. Everything is green.
> Then comes the merge. Two migrations, both numbered 0042. A service was
> renamed, and the other three agents still call it by its old name.
> Worktrees isolate files — not intentions."

**CAPTION** — *"Worktrees isolate files, not intentions."*

**DURATION** — 0:35.

---

## 0:35 – 1:05 · The worksite map — who is where, right now

**VISUAL** — Jira project page → **Worksite map**. The repository tree, colour-
coded by occupation: `src/billing/` amber (PROJ-101), `db/migrations/` red
(PROJ-93, reserved), `src/checkout/` blue (PROJ-88). Hover one file to show the
neighbour's name, actor and "active 2 min ago". (Fallback: the GitHub Pages
"Four agents" scenario's map view.)

**NARRATION**
> "This is the worksite map. It answers one question: who is on which part of
> the code, right now. Not at the merge. Right now. Every colour is a ticket,
> and every ticket knows its neighbours."

**CAPTION** — *"Who is where, in this moment."*

**DURATION** — 0:30.

---

## 1:05 – 2:05 · The hook, live — two agents adapt

**VISUAL** — Two side-by-side agent terminals. Left: Agent 2 starts to edit
`src/billing/invoice.ts`; a **PreToolUse** hook response is injected into its
context — `additionalContext` naming the rename in progress. Right: Agent 3 asks
for `db/migrations/0043_x.sql` and receives `permissionDecision: deny` (or a
`wait`) with the release time, then moves to another ticket. Show the raw hook
JSON once, then the agent's paraphrase.

**NARRATION**
> "Watch the hook do its job. Agent two is about to edit invoice. Before it
> writes a single line, the hook returns the neighbouring work, so it adapts.
> Agent three wants a migration. That folder is reserved. It receives 'wait',
> with the release time — and works on something else."

**CAPTION** — *"Informed before the first line. Denied only where it matters."*

**DURATION** — 1:00.

---

## 2:05 – 2:45 · Plan sprint 42 for four agents

**VISUAL** — Terminal running the Rovo agent site foreman, prompt
*"Plan sprint 42 for four agents."* The answer shows three collision-free waves;
the hinge ticket (the one that crosses most others) sits alone in wave one.

**NARRATION**
> "Same question a lead would ask: plan sprint forty-two for four agents. Three
> waves. The hinge ticket goes first and alone, because everything else touches
> it. After that, the rest runs in parallel — safely."

**CAPTION** — *"Three waves. Hinges first, then parallel."*

**DURATION** — 0:40.

---

## 2:45 – 3:15 · The humans too — Léa's PR arrives through CI

**VISUAL** — A GitHub pull request "PROJ-120 — refunds" from Léa, with the CI
step that posts `git diff` to `/ci/footprint`. On the Jira side, the worksite
map now shows `src/billing/refund.ts` attested to PROJ-120, and a notice
(`renaming invoices.total to total_cents`) is delivered to the neighbouring
agent on its next call.

**NARRATION**
> "The humans are on the same map. Léa's pull request arrives through CI — no
> agent, no hook, no install. Her footprint becomes attested. And her notice
> reaches the agents, without a single line of code being shared between them."

**CAPTION** — *"A developer with no tooling is still visible."*

**DURATION** — 0:30.

---

## 3:15 – 3:40 · Sprint check before committing

**VISUAL** — Jira sprint → **Check collisions**: the ticket-pair matrix, hinge
tickets highlighted, and the advised order. One pair shows a D2 (same file).

**NARRATION**
> "Before we commit to the sprint, one check. The matrix shows every risky pair.
> Most are free. One is D-two — same file. We reorder it, and we go."

**CAPTION** — *"Check the sprint before you start it."*

**DURATION** — 0:25.

---

## 3:40 – 4:05 · What we learn — the four numbers

**VISUAL** — The dashboard gadget, four large numbers, then the gadget's one-line
description under each. Numbers tick up as the four phases pass on screen.

**NARRATION**
> "And we measure ourselves. Collisions seen before the first line is written.
> Collisions seen while working. Collisions seen at the pull request. And the
> ones we missed until the merge — the number that must go down."

**CAPTION** — *"Before code · While working · At the PR · Missed until merge."*

**DURATION** — 0:25.

---

## 4:05 – 4:45 · Architecture

**VISUAL** — One clean diagram (the one in `docs/ARCHITECTURE.md`): four entry
points — Rovo MCP, agent hook, CI, Jira UI — flowing into services → core →
Forge SQL, with the two scheduled triggers beside.

**NARRATION**
> "Under the hood: one Forge app on Jira. Agents talk over Rovo MCP and over a
> single web trigger. CI posts the files it changed. Humans use Jira. Everything
> lands in Forge SQL — fourteen tables, no foreign keys — and two scheduled jobs
> keep it honest. Nothing is stored but paths."

**CAPTION** — *"rovo:mcp · actions · hook · web trigger · Forge SQL."*

**DURATION** — 0:40.

---

## Shooting checklist

- **Resolution** — 1920×1080, 16:9, 30 fps minimum; capture the browser at 100 %
  zoom so text is legible after YouTube compression.
- **Microphone** — a USB/headset mic, not the laptop's; record ambient-less, then
  normalise to −16 LUFS. Speak slower than you think (short sentences in the
  narration were written for that).
- **Pre-generated demo data** — warm up before rolling: run the "Four agents"
  scenario once so the maps/gadget are populated; pre-open the worksites so the
  collision verdicts look lived-in; have Léa's PR ready to push (or already
  pushed) for the 2:45 shot.
- **Capture order** — record in script order, one clip per shot, then cut:
  1) worktrees + merge, 2) worksite map, 3) hook terminals, 4) sprint plan,
  5) Léa's PR + notice, 6) sprint check, 7) four numbers, 8) architecture.
- **No secrets on screen** — run with the bearer token loaded from env, never
  pasted; blur any token if a terminal ever echoes it.
- **Subtitles** — bake the CAPTION text as lower-thirds; they are the only text a
  muted viewer will read.
- **Timing gate** — total must stay under 4:45 with the −3 % slack; if a shot
  overruns, cut the architecture shot (it can be a static card) rather than the
  hook or the merge.