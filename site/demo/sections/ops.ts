/**
 * Section: operations — the hook (observed footprint, warnings, hard-mode
 * deny), the CI attested footprint, and the lifecycle sweep. Prediction,
 * learning and tokens live in ops-knowledge.ts (same section, split for the
 * <500-lines rule). Owner: orchestrator.
 */

import { ciFootprint, hookClose, hookOpen, hookTouch } from "../../../src/services/ingest";
import { sweep } from "../../../src/services/maintenance";
import { minutesBetween } from "../../../src/testing/clock";
import { ACTORS, type DemoWorld } from "../world";
import { button, card, el, select, textarea, type SectionMount } from "./types";
import { learningCard, predictionCard, tokensCard } from "./ops-knowledge";

/* ------------------------------------------------------------------ */
/* Hook simulator (§9.3)                                               */
/* ------------------------------------------------------------------ */

function hookButtons(
  world: DemoWorld,
  actorRef: () => string,
  branch: HTMLInputElement,
  path: HTMLInputElement,
  log: HTMLElement,
): HTMLElement {
  const cwd = "/home/dev/billing";
  const controls = el("div", "row-flex");
  controls.appendChild(
    button("SessionStart → /open", () => {
      void hookOpen(world.ctx(actorRef()), {
        sessionRef: actorRef(),
        branch: branch.value,
        cwd,
        repoSlug: world.repoSlug,
      }).then((res) => {
        log.textContent = res.response.additionalContext ?? "(session opened, no neighbour to report)";
        world.touch();
      });
    }),
  );
  controls.appendChild(
    button("PreToolUse → /touch", () => {
      void hookTouch(world.ctx(actorRef()), {
        sessionRef: actorRef(),
        path: path.value,
        cwd,
        repoSlug: world.repoSlug,
      }).then((res) => {
        log.textContent = res.deny
          ? `DENIED (hard mode): ${res.deny.reason}`
          : (res.additionalContext ?? "(no warning — the agent continues)");
        world.touch();
      });
    }),
  );
  controls.appendChild(
    button("SessionEnd → /close", () => {
      void hookClose(world.ctx(actorRef()), { sessionRef: actorRef() }).then(() => {
        log.textContent = "(session closed — worksite paused; dormancy is the safety net)";
        world.touch();
      });
    }),
  );
  return controls;
}

function hookCard(world: DemoWorld): HTMLElement {
  const agents = ACTORS.filter((a) => a.kind === "agent");
  const body = el("div", "stack");
  const actor = select(
    agents.map((a) => ({ value: a.ref, label: a.displayName })),
    () => undefined,
  );
  const branch = el("input") as HTMLInputElement;
  branch.className = "sel";
  branch.value = "feature/PROJ-101-demo";
  const path = el("input") as HTMLInputElement;
  path.className = "sel";
  path.value = "/home/dev/billing/src/billing/invoice.ts";
  const log = el("div", "log", "Hook answers appear here — fail-open: an error never blocks the agent.");
  const actorRef = () => (actor as HTMLSelectElement).value;

  body.appendChild(el("p", "muted", "Actor (session):"));
  body.appendChild(actor);
  body.appendChild(el("p", "muted", "Branch (SessionStart) and absolute file path (PreToolUse), cwd /home/dev/billing:"));
  body.appendChild(branch);
  body.appendChild(path);
  body.appendChild(hookButtons(world, actorRef, branch, path, log));
  body.appendChild(log);
  return card("Hook simulator — observed without the agent's cooperation", body);
}

/* ------------------------------------------------------------------ */
/* CI push (§10)                                                       */
/* ------------------------------------------------------------------ */

function ciCard(world: DemoWorld): HTMLElement {
  const body = el("div", "stack");
  const branch = el("input") as HTMLInputElement;
  branch.className = "sel";
  branch.value = "feature/PROJ-120-fix";
  const issueKey = el("input") as HTMLInputElement;
  issueKey.className = "sel";
  issueKey.value = "PROJ-120";
  const files = textarea(3, "src/billing/tax.ts\nsrc/billing/rounding.ts");
  const prOpen = el("input") as HTMLInputElement;
  prOpen.type = "checkbox";
  const log = el("div", "log", "The CI step sends the branch file list — attested footprint, works for humans with no tooling.");
  const send = (br: string) => {
    void ciFootprint(world.ctx("ci"), {
      repoSlug: world.repoSlug,
      branch: br,
      issueKey: issueKey.value || undefined,
      files: files.value.split("\n"),
      prOpen: br !== "main" && prOpen.checked,
    }).then((res) => {
      log.textContent =
        res.worksite === undefined
          ? "(no ticket key — nothing attached)"
          : `${res.worksite.issueKey}: ${res.entries} file(s) attested · state ${res.worksite.state}${res.worksite.outcome ? ` · outcome ${res.worksite.outcome}` : ""}`;
      world.touch();
    });
  };
  const controls = el("div", "row-flex");
  controls.appendChild(button("Send CI footprint", () => send(branch.value)));
  controls.appendChild(button("Push to main (merge)", () => send("main")));
  const prLabel = el("label", "world-hard");
  prLabel.appendChild(prOpen);
  prLabel.appendChild(el("span", undefined, " PR open (→ review)"));
  controls.appendChild(prLabel);
  body.appendChild(el("p", "muted", "Branch and ticket key:"));
  body.appendChild(branch);
  body.appendChild(issueKey);
  body.appendChild(files);
  body.appendChild(controls);
  body.appendChild(log);
  return card("CI push — the attested footprint (§10)", body);
}

/* ------------------------------------------------------------------ */
/* Lifecycle (§11)                                                     */
/* ------------------------------------------------------------------ */

async function renderLifecycle(body: HTMLElement, world: DemoWorld): Promise<void> {
  const open = await world.stores.worksites.listOpenByRepo(world.repoId());
  const now = world.clock.now();
  const table = el("table", "kv");
  for (const w of open) {
    const tr = el("tr");
    tr.appendChild(el("td", "kv-k", `${w.issueKey} · ${w.kind}`));
    tr.appendChild(
      el("td", "kv-v", `${w.state} · active ${minutesBetween(w.lastActivityAt, now)} min ago`),
    );
    table.appendChild(tr);
  }
  if (open.length === 0) {
    table.appendChild(el("tr")).appendChild(el("td", "muted", "no open worksite"));
  }
  body.replaceChildren(table);
}

function lifecycleCard(world: DemoWorld): HTMLElement {
  const body = el("div", "stack");
  const table = el("div");
  const log = el("div", "log", "Sweep results appear here (the clock buttons of the world bar run it too).");
  body.appendChild(table);
  body.appendChild(
    button("Run the sweep now", () => {
      void sweep(world.ctx("dev")).then((res) => {
        log.textContent = JSON.stringify(res, null, 1);
        world.touch();
      });
    }),
  );
  body.appendChild(log);
  void renderLifecycle(table, world);
  return card("Lifecycle — no ghost worksite, no eternal reservation", body);
}

/* ------------------------------------------------------------------ */
/* Mount                                                               */
/* ------------------------------------------------------------------ */

export const mountOps: SectionMount = (root, world) => {
  root.replaceChildren();
  const grid = el("div", "section-grid");
  grid.appendChild(hookCard(world));
  grid.appendChild(ciCard(world));
  grid.appendChild(lifecycleCard(world));
  grid.appendChild(predictionCard(world));
  grid.appendChild(learningCard(world));
  grid.appendChild(tokensCard(world));
  root.appendChild(grid);
};
