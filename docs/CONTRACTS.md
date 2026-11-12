# CONTRACTS — module map & ground rules

Read this fully before writing a line. The product spec is `docs/SPEC.md`
(French); section numbers below refer to it.

## Golden rules (non-negotiable)

1. **Files < 500 lines, functions < 50 lines.** Split when needed. Zero
   duplication: reuse `src/services/shared.ts` and `src/core/*` helpers.
2. **Frozen files — never modify**: `src/core/types.ts`,
   `src/storage/interfaces.ts`, `src/services/ctx.ts`,
   `src/services/shared.ts`, `src/testing/clock.ts`, `src/ui/components.tsx`,
   `src/i18n/*`. If a contract is missing something, work around it locally
   and report the gap in your final answer — the orchestrator arbitrates.
3. **Stay in your lane**: create/modify ONLY the files your workstream owns
   (table below). Never touch another workstream's files, even to "fix" them.
4. **Pure core & services**: no `@forge/*` import in `src/core/`,
   `src/services/` (except `ctx.ts` types), `src/simulation/`, `src/ui/`
   (except `@forge/ui`), `tests/`. `@forge/sql` only in `src/storage/forge/`
   and `src/storage/schema.ts`; other `@forge/*` glue only in `src/index.ts`
   and `src/glue/`.
5. **Time**: always `ctx.now()` (ISO strings), never `Date.now()` in
   services/core. Tests use `src/testing/clock.makeClock`.
6. **Identity**: never trust tool inputs for identity — always
   `ctx.identity` (spec §9.6).
7. **i18n**: user-facing strings via `src/i18n` (`dictFor` + `format`,
   MsgId keys). No hard-coded sentences in core/verdict output.
8. **Verify before finishing** (from the repo root):
   ```bash
   npx tsc --noEmit
   npx vitest run tests/<your-dir>       # your tests green
   npx eslint <your-files>
   ```
   `tsc` covers the whole repo: if it fails on ANOTHER workstream's file,
   that is not yours to fix — note it in your report. Your own files must be
   error-free. After 3 failed attempts at the same error, stop and report KO
   with the exact error.
9. **Do not delegate** — do the work yourself.
10. Replace stub bodies (`throw new Error("TODO(...)")`) with real code;
    keep the exported signatures EXACTLY as stubbed.

## Workstream ownership

| WS | Files (create/own) | Depends on |
|----|--------------------|-----------|
| A | `src/core/paths.ts`, `src/core/zones.ts`, `tests/core/paths.test.ts`, `tests/core/zones.test.ts` | types |
| B | `src/core/degrees.ts`, `src/core/collisions.ts`, `src/core/verdict.ts`, `tests/core/degrees.test.ts`, `tests/core/collisions.test.ts`, `tests/core/verdict.test.ts` | A (paths, zones), i18n |
| C | `src/core/priority.ts`, `src/core/waves.ts`, `tests/core/priority.test.ts`, `tests/core/waves.test.ts` | A |
| D | `src/core/footprints.ts`, `src/core/lifecycle.ts`, `src/core/notices.ts`, `src/core/predict.ts`, `tests/core/footprints.test.ts`, `tests/core/lifecycle.test.ts`, `tests/core/predict.test.ts` | A |
| E | `src/storage/schema.ts`, `src/storage/forge/**` (`index.ts` + split files) | interfaces, @forge/sql |
| F | `src/storage/memory/**` (`index.ts` + split files), `tests/storage/memory.test.ts` | interfaces, A (paths for findOverlapping) |
| G | `src/services/declare.ts`, `worksites.ts`, `notices.ts`, `reservations.ts`, `resolve.ts`, `tests/services/declare.test.ts`, `worksites.test.ts`, `notices.test.ts`, `reservations.test.ts` | A–D, F, shared |
| H | `src/services/planning.ts`, `ingest.ts`, `maintenance.ts`, `tokens.ts`, `tests/services/planning.test.ts`, `ingest.test.ts`, `maintenance.test.ts`, `tokens.test.ts` | A–D, F, G (stubs OK), shared |
| I | `src/index.ts`, `src/glue/**`, `src/forge-context.ts`, `manifest.yml` (polish), `prompts/*.md` wiring check | everything (types only at first) |
| J | `src/ui/issuePanel.tsx`, `src/ui/gadget.tsx`, `src/ui/simulation.tsx`, `tests/ui/*.test.ts` (data-shape only) | components (frozen), types |
| K | `src/ui/worksiteMap.tsx`, `src/ui/sprintCheck.tsx`, `src/ui/projectSettings.tsx`, `src/ui/personalSettings.tsx` | components (frozen), types |
| L | `README.md`, `docs/ARCHITECTURE.md`, `docs/JUDGES.md`, `docs/PROTOCOL.md`, `templates/**`, `prompts/site-foreman.md`, `prompts/avoid-collisions.md` | spec |
| M | `src/simulation/run.ts`, `src/simulation/scenarios.ts`, `tests/scenarios/recette.test.ts`, `tests/fixtures/four-agents.ts` | F, G, H (services) |

## Key semantics (where people get it wrong)

- **Overlap search** (spec §18): for a file, compare its exact path and each
  parent dir; for a dir, also everything starting with it; patterns via
  `entriesOverlap`. `findOverlapping` scopes by repo only; services filter
  closed worksites.
- **Degrees** (§7): D4 exclusive/frozen/reserved-by-third; D3 same file +
  delete/rename; D2 same file; D1 same dir; D0 same zone. Hotspot −1,
  dormant neighbour −1, prediction-only ⇒ capped D1 + `probable`. Same
  pilot ⇒ NO discount.
- **Verdict** (§7/§8): free (none/D0), caution (D1–D2), wait (D3, D4),
  stop (D4 + hard mode). EVERY verdict names the neighbour, cites the path
  and says what to do (`shared.buildVerdict` assembles; B provides wording).
- **One collision per (pair, zone)** — `CollisionStore.upsert` keeps the
  first `detectedAt`, updates degree/path.
- **Notices**: delivered ONCE per session (`pendingFor` + `markDelivered`
  only when the response actually goes out: MCP verdict or hook response).
- **Reservations**: default 120 min, max 1440, extend on observed activity,
  release on expiry (sweep). Hard reservation + project hardMode ⇒ hook
  `permissionDecision: deny`.
- **Hook ingest** (§17): read ONLY path/session/cwd from the event; discard
  everything else before processing or storage. Fail-open: any error ⇒
  empty response, the agent continues.
- **Lifecycle** (§11): dormant after `rules.dormancyHours` idle; closed
  after `DORMANT_CLOSE_DAYS` dormant; closing releases waiting neighbours.
- **Waves** (§9.5): graph = D2+ collisions or shared exclusive resource;
  hinges (max degree) alone in wave 0; then priority packing ≤ workers,
  never two linked tickets in one wave; watchPairs = hotspot-only overlaps.
- **Prediction** (§5/§12): never blocking, capped D1, confidence announced,
  measured against attested footprint at merge.

## Testing conventions

- Test files: `tests/<area>/<name>.test.ts`, vitest, no network, no mocks of
  your own module — test the real thing on `createMemoryStores()`.
- Build Ctx with: `makeClock()`, identity literals, `stores` from memory,
  and a fake `jira` port when needed (plain object implementing JiraPort).
- Acceptance scenarios of spec §22 live in `tests/scenarios/recette.test.ts`
  (owner M) — if you implement one of its cases, make sure your unit tests
  cover the same ground.

## Manifest & glue

- 16 MCP tools = 16 `action` entries = resolver keys wired in `src/index.ts`
  via `@forge/resolver` (`new Resolver()` default export, `.define(key, fn)`,
  `export const handler = resolver.toHandler()` — check the installed d.ts).
- Web trigger `ingest` receives the RAW client hook event; routes by URL
  path suffix: `/open`, `/touch`, `/close`, `/ci/footprint`, `/ci/conflict`.
  Auth: `Authorization: Bearer <token>` (verifyToken) + `X-Chantier-Repo`
  header optional. Response = hook JSON (`hookSpecificOutput` with
  `additionalContext` or `permissionDecision`).
- `scripts/check-manifest.mjs` is the CI gate for manifest consistency
  (tools ↔ actions ↔ functions). Run it after touching manifest.yml.
