/**
 * Section: the worksite panel (spec §16.1) — footprints by source,
 * neighbours, collisions with their six outcomes, notices and reservations.
 * Everything runs on the shared demo world through the REAL services.
 * Owner: orchestrator.
 */

import type { Collision, Reservation, ResolutionChoice, WorksitePanel } from "../../../src/core/types";
import { minutesBetween } from "../../../src/testing/clock";
import { getWorksitePanel, closeWorksite } from "../../../src/services/worksites";
import { resolveCollision } from "../../../src/services/resolve";
import { postNotice } from "../../../src/services/notices";
import { reserveZone } from "../../../src/services/reservations";
import { ACTORS, type DemoWorld } from "../world";
import { button, card, degreeChip, el, select, textarea, type SectionMount } from "./types";

const CHOICES: ResolutionChoice[] = [
  "wait",
  "sequence",
  "coordinate",
  "split",
  "merge",
  "override",
];

/** Selection survives re-mounts (the page re-mounts on every world change). */
let selectedKey: string | undefined;

/** Actor ref that owns a worksite (by account), for notices/reservations. */
function ownerRef(panel: WorksitePanel): string {
  const account = panel.repos
    .flatMap((r) => r.worksites)
    .map((w) => w.accountId)
    .find((a) => a !== undefined);
  return ACTORS.find((a) => a.accountId === account)?.ref ?? "dev";
}

async function openWorksiteKeys(world: DemoWorld): Promise<string[]> {
  const open = await world.stores.worksites.listOpenByRepo(world.repoId());
  return [...new Set(open.map((w) => w.issueKey))].sort();
}

/* ------------------------------------------------------------------ */
/* Collisions and their six outcomes                                   */
/* ------------------------------------------------------------------ */

function collisionRow(
  c: Collision,
  zoneName: string | undefined,
  world: DemoWorld,
  actor: string,
  log: HTMLElement,
): HTMLElement {
  const tr = el("tr");
  const degree = el("td");
  degree.appendChild(degreeChip(c.degree));
  tr.appendChild(degree);
  tr.appendChild(el("td", undefined, c.path));
  tr.appendChild(el("td", "muted", zoneName ?? "—"));
  const actions = el("td");
  for (const choice of CHOICES) {
    actions.appendChild(
      button(
        choice,
        () =>
          void resolveCollision(world.ctx(actor), {
            collisionId: c.id,
            choice,
            reason: "demo",
          }).then((out) => {
            log.textContent = JSON.stringify(out, null, 1);
            world.touch();
          }),
        "btn small",
      ),
    );
    actions.appendChild(el("span", undefined, " "));
  }
  tr.appendChild(actions);
  return tr;
}

function collisionsCard(
  panel: WorksitePanel,
  world: DemoWorld,
  actor: string,
): HTMLElement {
  const body = el("div", "stack");
  const log = el("div", "log", "Pick an outcome — the result appears here.");
  const rows = panel.repos.flatMap((r) => r.collisions);
  if (rows.length === 0) {
    body.appendChild(el("p", "muted", "No collision on this ticket right now."));
  } else {
    const table = el("table", "kv");
    for (const c of rows) {
      table.appendChild(collisionRow(c, undefined, world, actor, log));
    }
    body.appendChild(table);
  }
  body.appendChild(log);
  return card("Collisions — six outcomes (§8)", body);
}

/* ------------------------------------------------------------------ */
/* Footprints, neighbours, notices, reservations                       */
/* ------------------------------------------------------------------ */

function footprintsCard(panel: WorksitePanel): HTMLElement {
  const body = el("div", "stack");
  for (const repoBlock of panel.repos) {
    const coverage = Object.entries(repoBlock.coverage)
      .map(([source, count]) => `${source}: ${count ?? 0}`)
      .join(" · ");
    body.appendChild(el("p", "muted", `${repoBlock.repo.slug} — coverage ${coverage}`));
    for (const source of ["predicted", "declared", "observed", "attested"] as const) {
      const entries = repoBlock.footprintsBySource[source] ?? [];
      if (entries.length === 0) continue;
      const table = el("table", "kv");
      for (const e of entries) {
        const tr = el("tr");
        tr.appendChild(el("td", "kv-k", source));
        tr.appendChild(
          el("td", "kv-v", `${e.path} · ${e.kind} · ${e.mode}${e.declaredMismatch ? " · ⚠ declared gap" : ""}`),
        );
        table.appendChild(tr);
      }
      body.appendChild(table);
    }
  }
  return card("Footprint by source — the fact beats the intent (§5)", body);
}

function neighborsCard(panel: WorksitePanel, world: DemoWorld): HTMLElement {
  const body = el("div", "stack");
  const now = world.clock.now();
  for (const repoBlock of panel.repos) {
    if (repoBlock.neighbors.length === 0) {
      body.appendChild(el("p", "muted", "No neighbour on this ground."));
    }
    for (const n of repoBlock.neighbors) {
      body.appendChild(
        el(
          "p",
          undefined,
          `${n.issueKey} · ${n.actorLabel} · ${n.state} · active ${minutesBetween(n.lastActivityAt, now)} min ago`,
        ),
      );
    }
  }
  return card("Neighbours", body);
}

function noticesCard(panel: WorksitePanel, world: DemoWorld, actor: string): HTMLElement {
  const body = el("div", "stack");
  const inbox = panel.repos.flatMap((r) => r.noticesInbox);
  const sent = panel.repos.flatMap((r) => r.noticesSent);
  body.appendChild(
    el(
      "p",
      undefined,
      inbox.length === 0
        ? "Inbox: empty."
        : `Inbox: ${inbox.map((n) => `[${n.fromIssueKey}] “${n.text}”`).join(" · ")}`,
    ),
  );
  body.appendChild(el("p", "muted", `Sent: ${sent.length} notice(s). Delivered ONCE per session.`));
  const paths = textarea(2, "db/migrations");
  const text = el("input") as HTMLInputElement;
  text.className = "sel";
  text.style.width = "100%";
  text.placeholder = "short message, e.g. renaming invoices.total to total_cents";
  const out = el("p", "muted");
  body.appendChild(paths);
  body.appendChild(text);
  body.appendChild(out);
  body.appendChild(
    button("Post a notice", () => {
      void postNotice(world.ctx(actor), {
        issueKey: panel.issueKey,
        repoSlug: world.repoSlug,
        paths: paths.value,
        text: text.value,
      })
        .then((res) => {
          out.textContent = `sent to ${res.recipients.map((r) => r.issueKey).join(", ") || "nobody (no overlap)"}`;
          world.touch();
        })
        .catch((e: Error) => {
          out.textContent = `error: ${e.message}`;
        });
    }),
  );
  return card("Worksite mailbox (§9.4)", body);
}

function reservationsCard(panel: WorksitePanel, world: DemoWorld, actor: string): HTMLElement {
  const body = el("div", "stack");
  const now = world.clock.now();
  const rows: Reservation[] = panel.repos.flatMap((r) => r.reservations);
  if (rows.length === 0) body.appendChild(el("p", "muted", "No reservation."));
  for (const r of rows) {
    const left = minutesBetween(now, r.expiresAt);
    body.appendChild(
      el("p", undefined, `${r.patterns.join(", ")} · ${r.hard ? "HARD" : "soft"} · expires in ${left} min`),
    );
  }
  const paths = textarea(2, "db/migrations");
  const out = el("p", "muted");
  body.appendChild(paths);
  body.appendChild(
    button("Reserve for 2 h (default, capped at 24 h)", () => {
      void reserveZone(world.ctx(actor), {
        issueKey: panel.issueKey,
        repoSlug: world.repoSlug,
        paths: paths.value,
      }).then((res) => {
        out.textContent =
          "refused" in res ? `refused: ${res.reason}` : `reserved until ${res.expiresAt}`;
        world.touch();
      });
    }),
  );
  body.appendChild(out);
  return card("Reservations — nothing eternal (§11)", body);
}

/* ------------------------------------------------------------------ */
/* Mount                                                               */
/* ------------------------------------------------------------------ */

async function renderPanel(body: HTMLElement, world: DemoWorld, key: string): Promise<void> {
  const panel = await getWorksitePanel(world.ctx("dev"), key);
  const actor = ownerRef(panel);
  body.replaceChildren(
    footprintsCard(panel),
    neighborsCard(panel, world),
    collisionsCard(panel, world, actor),
    noticesCard(panel, world, actor),
    reservationsCard(panel, world, actor),
  );
}

export const mountPanel: SectionMount = (root, world) => {
  root.replaceChildren();
  const controls = el("div", "row-flex");
  const body = el("div", "stack");
  const closeOut = el("p", "muted");
  void openWorksiteKeys(world).then((keys) => {
    if (keys.length === 0) {
      body.replaceChildren(el("p", "muted", "No open worksite — declare one in the playground or planning sections."));
      return;
    }
    if (!selectedKey || !keys.includes(selectedKey)) selectedKey = keys[0];
    const picker = select(
      keys.map((k) => ({ value: k, label: k })),
      (value) => {
        selectedKey = value;
        void renderPanel(body, world, value);
      },
    );
    picker.setAttribute("data-testid", "ticket-picker");
    (picker as HTMLSelectElement).value = selectedKey;
    controls.replaceChildren(picker);
    controls.appendChild(
      button("Close worksite (merged)", () => {
        void closeWorksite(world.ctx("dev"), {
          issueKey: selectedKey!,
          outcome: "merged",
        }).then((res) => {
          closeOut.textContent = `closed ${res.closed.length} worksite(s), released ${res.released.length} neighbour(s)`;
          selectedKey = undefined;
          world.touch();
        });
      }),
    );
    controls.appendChild(closeOut);
    void renderPanel(body, world, selectedKey);
  });
  root.appendChild(controls);
  root.appendChild(body);
};

