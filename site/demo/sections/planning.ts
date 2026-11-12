/**
 * Section: sprint planning — waves, sprint check, dispatcher, clear work and
 * live collisions. Runs the REAL planning services (services/planning) against
 * the shared demo world: in-memory stores + the world's Jira stub, no server.
 *
 * Footprints come from planTicketFor: declared/attested worksite footprints
 * win, stored predictions fill the gaps. So the section first seeds the
 * predictions of every sprint ticket (ensurePredictions, idempotent).
 *
 * FINAL SEEDED PATHS (DEMO_PATHS below) — verified against the real engine:
 * predictFromHistory alone rolls every component up to coarse dirs
 * (src/billing, db/migrations, src/i18n, src/auth — ROLLUP_SHARE 0.6), which
 * is too little for a telling file-level story, so ensurePredictions runs the
 * real predictor (confidence + basis come from it) but stores the curated
 * paths. With the world's declared footprints (88: invoice.ts, 93: 0101,
 * 95: 0102, 97: login.ts, 70 attested: invoice.ts + tax.ts), the resulting
 * plan graph is:
 *  - PROJ-101 is the hinge (degree 5: invoice.ts × 88/90/70 + the exclusive
 *    migrations zone × 93/95) — the brief expected PROJ-90, but 90 only
 *    crosses 88/70/101 on invoice.ts (degree 3); 101 is the true hinge and
 *    satisfies "≥ 1 hinge, ≥ 2 waves";
 *  - 4 waves with 3 workers: [101] · [93, 88, 97] · [95, 90, 105] · [70];
 *  - sprint check risky pairs include 88 × 90 (D2, invoice.ts) and 93 × 95
 *    (D4, exclusive migrations);
 *  - initially clear: PROJ-105 only → the dispatcher has a real answer, and
 *    "Start it" opens one more worksite.
 */

import type { Collision, SprintCheckData, TicketMeta, WavePlan, Zone } from "../../../src/core/types";
import { classifyPath } from "../../../src/core/paths";
import { predictFromHistory } from "../../../src/core/predict";
import { declareFootprint } from "../../../src/services/declare";
import {
  listClearWork,
  listCollisions,
  nextClearTicket,
  planParallelWork,
  sprintCheck,
  type NextClearTicket,
} from "../../../src/services/planning";
import { ACTORS, DEMO_HISTORY, DEMO_TICKETS, type DemoWorld } from "../world";
import { button, card, degreeChip, el, select, type SectionMount } from "./types";

/** The sprint every planning call of this section runs on. */
const JQL = "sprint = 42";

/** Curated per-ticket footprint — see the file header for the verified outcome. */
const DEMO_PATHS: Record<string, string[]> = {
  "PROJ-88": ["src/billing/invoice.ts", "db/migrations/0103_total_cents.sql"],
  "PROJ-90": ["src/billing/service.ts", "src/billing/invoice.ts"],
  "PROJ-93": ["db/migrations/0101_renumber.sql"],
  "PROJ-95": ["db/migrations/0102_index.sql"],
  "PROJ-97": ["src/auth/login.ts"],
  "PROJ-101": ["db/migrations/0104_index.sql", "src/billing/invoice.ts"],
  "PROJ-105": ["src/i18n/messages.json"],
  // PROJ-70 (merged) is intentionally absent: world.ts already stores its
  // prediction and its attested footprint, which planTicketFor prefers.
};

/**
 * Seed the predictions of the sprint tickets (idempotent: an existing
 * prediction is kept, and the memory store upserts by (issueKey, repoId)).
 * The real predictor runs for confidence/basis; entries are the curated demo
 * paths (the raw prediction is a single coarse dir per component — too little).
 */
export async function ensurePredictions(world: DemoWorld): Promise<void> {
  const stores = world.stores;
  const repoId = world.repoId();
  const computedAt = world.clock.now();
  for (const ticket of DEMO_TICKETS) {
    const paths = DEMO_PATHS[ticket.issueKey];
    if (!paths) continue;
    if ((await stores.predictions.findByIssue(ticket.issueKey, repoId)).length > 0) continue;
    const predicted = predictFromHistory(ticket, DEMO_HISTORY);
    await stores.predictions.save({
      issueKey: ticket.issueKey,
      repoId,
      entries: paths.map((path) => ({ path, kind: classifyPath(path), confidence: 0.6 })),
      confidence: predicted.confidence > 0 ? predicted.confidence : 0.5,
      basis: {
        componentMatch: predicted.componentMatch,
        referenceTickets: predicted.referenceTickets,
      },
      computedAt,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Rendering helpers (local to this section)                           */
/* ------------------------------------------------------------------ */

/** Discrete inline table chrome: styles.css has no data-table class (only .kv). */
const TABLE_CSS = "width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;";
const TH_CSS = "text-align:left;padding:4px 8px;border-bottom:1px solid #30363d;font-size:12px;";
const TD_CSS = "padding:4px 8px;border-bottom:1px solid #21262d;vertical-align:top;";

function dataTable(headers: string[], rows: (string | HTMLElement)[][]): HTMLElement {
  const table = el("table");
  table.style.cssText = TABLE_CSS;
  const head = el("tr");
  for (const h of headers) {
    const th = el("th", "muted", h);
    th.style.cssText = TH_CSS;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const row of rows) {
    const tr = el("tr");
    for (const cell of row) {
      const td = el("td");
      td.style.cssText = TD_CSS;
      if (typeof cell === "string") td.textContent = cell;
      else td.appendChild(cell);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}

/** Runs an async panel: seeds predictions, guards errors, renders into `out`. */
function runner(world: DemoWorld, out: HTMLElement, fn: (out: HTMLElement) => Promise<void>): () => void {
  return () => {
    out.replaceChildren(el("p", "muted", "computing…"));
    void (async () => {
      try {
        await ensurePredictions(world);
        await fn(out);
      } catch (e) {
        out.replaceChildren(el("p", "ko", `error: ${e instanceof Error ? e.message : String(e)}`));
      }
    })();
  };
}

/* ------------------------------------------------------------------ */
/* 1. Plan parallel work                                               */
/* ------------------------------------------------------------------ */

function renderPlan(out: HTMLElement, plan: WavePlan): void {
  out.replaceChildren();
  const hinges = new Set(plan.hinges);
  plan.waves.forEach((wave, i) => {
    const line = el("div", "wave");
    line.appendChild(el("b", undefined, `Wave ${i + 1}`));
    const label = wave.map((k) => (hinges.has(k) ? `${k} (hinge)` : k)).join(", ");
    line.appendChild(document.createTextNode(` — ${label}`));
    out.appendChild(line);
  });
  if (plan.hinges.length > 0) {
    out.appendChild(el("p", undefined, `Hinges: ${plan.hinges.join(", ")} — alone and first, their wide footprint lands before the rest.`));
  }
  for (const w of plan.watchPairs) out.appendChild(el("p", "muted", `${w.a} × ${w.b} — ${w.why}`));
  if (plan.watchPairs.length === 0) out.appendChild(el("p", "muted", "No hotspot watch pair in this sprint."));
  const note = plan.confidenceNote ? ` — ${plan.confidenceNote}` : "";
  out.appendChild(el("p", undefined, `Confidence: ${plan.confidence}${note}`));
}

function planCard(world: DemoWorld): HTMLElement {
  let workers = 3;
  const out = el("div", "stack");
  const sel = select(
    [2, 3, 4].map((n) => ({ value: String(n), label: `${n} workers` })),
    (v) => {
      workers = Number(v);
    },
  );
  sel.value = "3";
  const run = runner(world, out, async (o) => {
    renderPlan(o, await planParallelWork(world.ctx("dev"), { jql: JQL, workers }));
  });
  const row = el("div", "row-flex");
  row.append(sel, button("Plan the sprint", run));
  return card("Plan parallel work", row, out);
}

/* ------------------------------------------------------------------ */
/* 2. Sprint check                                                     */
/* ------------------------------------------------------------------ */

function renderSprintCheck(out: HTMLElement, data: SprintCheckData): void {
  out.replaceChildren();
  out.appendChild(
    dataTable(
      ["A", "B", "Degree", "Path", "Zone"],
      data.riskyPairs.map((p) => [p.a, p.b, degreeChip(p.degree), p.path, p.zoneName ?? "—"]),
    ),
  );
  if (data.riskyPairs.length === 0) out.appendChild(el("p", "ok", "No risky pair (D2+) in this sprint."));
  out.appendChild(
    el("p", undefined, data.hinges.length > 0 ? `Hinges: ${data.hinges.join(", ")}` : "No hinge ticket."),
  );
  const order = el("ol");
  for (const key of data.suggestedOrder) order.appendChild(el("li", undefined, key));
  out.appendChild(order);
  const note = data.confidenceNote ? ` — ${data.confidenceNote}` : "";
  out.appendChild(el("p", "muted", `Confidence: ${data.confidence}${note}`));
}

function sprintCheckCard(world: DemoWorld): HTMLElement {
  const out = el("div", "stack");
  const run = runner(world, out, async (o) => {
    renderSprintCheck(o, await sprintCheck(world.ctx("dev"), DEMO_TICKETS.map((t) => t.issueKey)));
  });
  return card("Sprint check", button("Check the sprint", run), out);
}

/* ------------------------------------------------------------------ */
/* 3. Dispatcher — "the next clear ticket for this worker"             */
/* ------------------------------------------------------------------ */

async function startTicket(world: DemoWorld, actorRef: string, issueKey: string): Promise<void> {
  const actor = ACTORS.find((a) => a.ref === actorRef);
  const preds = await world.stores.predictions.findByIssue(issueKey, world.repoId());
  const paths = preds.flatMap((p) => p.entries.map((e) => e.path));
  if (actor && paths.length > 0) {
    await declareFootprint(world.ctx(actorRef), {
      issueKey,
      repoSlug: world.repoSlug,
      paths: paths.join("\n"),
      session: actor.sessionRef,
    });
  }
  world.touch(); // every section re-renders: the queue visibly moves forward
}

function renderDispatcher(out: HTMLElement, world: DemoWorld, actorRef: string, next: NextClearTicket): void {
  out.replaceChildren();
  const issueKey = next.issueKey;
  if (!issueKey) {
    out.appendChild(el("p", "muted", next.why));
    return;
  }
  const summary = next.ticket?.summary ? ` — ${next.ticket.summary}` : "";
  out.appendChild(el("p", undefined, `Next clear ticket: ${issueKey}${summary}`));
  out.appendChild(el("p", "muted", next.why));
  if (next.alternatives.length > 0) {
    const row = el("div", "row-flex");
    row.appendChild(el("span", "muted", "Alternatives:"));
    for (const alt of next.alternatives) row.appendChild(el("span", "chip", alt));
    out.appendChild(row);
  }
  out.appendChild(button("Start it", () => void startTicket(world, actorRef, issueKey)));
}

function dispatcherCard(world: DemoWorld): HTMLElement {
  const agents = ACTORS.filter((a) => a.kind === "agent");
  let actorRef = agents[0]?.ref ?? "a1";
  const out = el("div", "stack");
  const sel = select(
    agents.map((a) => ({ value: a.ref, label: a.displayName })),
    (v) => {
      actorRef = v;
    },
  );
  const run = runner(world, out, async (o) => {
    const actor = ACTORS.find((a) => a.ref === actorRef);
    const next = await nextClearTicket(world.ctx(actorRef), { jql: JQL, session: actor?.sessionRef });
    renderDispatcher(o, world, actorRef, next);
  });
  const row = el("div", "row-flex");
  row.append(sel, button("Next clear ticket", run));
  return card("Dispatcher", row, out);
}

/* ------------------------------------------------------------------ */
/* 4. Clear work                                                       */
/* ------------------------------------------------------------------ */

function renderClear(out: HTMLElement, tickets: TicketMeta[]): void {
  out.replaceChildren();
  if (tickets.length === 0) {
    out.appendChild(el("p", "muted", "No clear ticket right now — every candidate collides or is taken."));
    return;
  }
  const row = el("div", "row-flex");
  for (const t of tickets) row.appendChild(el("span", "chip chip-free", t.issueKey));
  out.appendChild(row);
}

function clearWorkCard(world: DemoWorld): HTMLElement {
  const out = el("div", "stack");
  const run = runner(world, out, async (o) => {
    renderClear(o, await listClearWork(world.ctx("dev"), { jql: JQL }));
  });
  return card("Clear work", button("List clear work", run), out);
}

/* ------------------------------------------------------------------ */
/* 5. Live collisions                                                  */
/* ------------------------------------------------------------------ */

/** listCollisions scores virtual worksites named `plan-<i>-<issueKey>`. */
function issueOf(worksiteId: string): string {
  return /^plan-\d+-(.+)$/.exec(worksiteId)?.[1] ?? worksiteId;
}

function renderCollisions(out: HTMLElement, collisions: Collision[], zones: Zone[]): void {
  out.replaceChildren();
  out.appendChild(
    dataTable(
      ["A", "B", "Degree", "Path", "Zone", "State"],
      collisions.map((c) => [
        issueOf(c.worksiteA),
        issueOf(c.worksiteB),
        degreeChip(c.degree),
        c.path,
        zones.find((z) => z.id === c.zoneId)?.name ?? "—",
        c.state,
      ]),
    ),
  );
  if (collisions.length === 0) out.appendChild(el("p", "ok", "No collision (D1+) among the sprint tickets."));
}

function collisionsCard(world: DemoWorld): HTMLElement {
  const out = el("div", "stack");
  const run = runner(world, out, async (o) => {
    const [collisions, zones] = await Promise.all([
      listCollisions(world.ctx("dev"), { jql: JQL }),
      world.stores.zones.listByRepo(world.repoId()),
    ]);
    renderCollisions(o, collisions, zones);
  });
  return card("Live collisions", button("List collisions", run), out);
}

/* ------------------------------------------------------------------ */
/* Mount                                                               */
/* ------------------------------------------------------------------ */

export const mountPlanning: SectionMount = (root, world) => {
  root.replaceChildren();
  const grid = el("div", "section-grid");
  grid.append(
    planCard(world),
    sprintCheckCard(world),
    dispatcherCard(world),
    clearWorkCard(world),
    collisionsCard(world),
  );
  root.appendChild(grid);
  // Fire-and-forget: seed the predictions so the panels answer as soon as
  // they are clicked (the runner awaits it again — idempotent).
  void ensurePredictions(world);
};
