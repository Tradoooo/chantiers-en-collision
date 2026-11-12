/**
 * Ops section, part 2 — prediction, the learning loop, tokens and the event
 * journal. Split from ops.ts for the <500-lines rule; mounted by it.
 * Owner: orchestrator.
 */

import { predictFromHistory } from "../../../src/core/predict";
import { learningReport } from "../../../src/services/learning";
import { createToken } from "../../../src/services/tokens";
import { DEMO_TICKETS, type DemoWorld } from "../world";
import { button, card, el, select } from "./types";

/* ------------------------------------------------------------------ */
/* Prediction (§5, §12)                                                */
/* ------------------------------------------------------------------ */

export function predictionCard(world: DemoWorld): HTMLElement {
  const body = el("div", "stack");
  const picker = select(
    DEMO_TICKETS.map((t) => ({ value: t.issueKey, label: `${t.issueKey} — ${t.summary ?? ""}` })),
    () => undefined,
  );
  const out = el("div", "stack");
  const run = async () => {
    const ticket = DEMO_TICKETS.find((t) => t.issueKey === (picker as HTMLSelectElement).value);
    if (!ticket) return;
    const history = (await world.jira.mergedHistory?.(world.repoSlug)) ?? [];
    const p = predictFromHistory(ticket, history);
    out.replaceChildren(
      el(
        "p",
        undefined,
        p.entries.length === 0
          ? "No prediction — this ticket has no comparable merged history."
          : `confidence ${Math.round(p.confidence * 100)} % · component match: ${p.componentMatch ? "yes" : "no"} · references: ${p.referenceTickets.join(", ") || "—"}`,
      ),
    );
    const table = el("table", "kv");
    for (const e of p.entries.slice(0, 8)) {
      const tr = el("tr");
      tr.appendChild(el("td", "kv-k", e.path));
      tr.appendChild(el("td", "kv-v", `${Math.round(e.confidence * 100)} %`));
      table.appendChild(tr);
    }
    out.appendChild(table);
    out.appendChild(el("p", "muted", "Never blocking: a prediction-only collision is capped at D1 and labelled “probable”."));
  };
  body.appendChild(picker);
  body.appendChild(button("Predict footprint", () => void run()));
  body.appendChild(out);
  void run();
  return card("Prediction — before anyone writes a line", body);
}

/* ------------------------------------------------------------------ */
/* Learning loop (§13, CC-25)                                          */
/* ------------------------------------------------------------------ */

export function learningCard(world: DemoWorld): HTMLElement {
  const body = el("div", "stack");
  const out = el("div", "stack");
  body.appendChild(
    button("Run the learning report", () => {
      void learningReport(world.ctx("dev"), { repoSlug: world.repoSlug })
        .then((report) => {
          out.replaceChildren();
          const n = report.fourNumbers;
          out.appendChild(
            el(
              "p",
              undefined,
              `Collisions seen — before code: ${n.seenBeforeCode} · while working: ${n.seenWhileWorking} · at PR: ${n.seenAtPr} · missed until merge: ${n.missedUntilMerge}`,
            ),
          );
          const acc = report.accuracy;
          out.appendChild(
            el(
              "p",
              undefined,
              acc.overall === undefined
                ? "Prediction accuracy: no merged worksite measured yet."
                : `Prediction accuracy: ${Math.round(acc.overall * 100)} % over ${acc.samples} attested path(s)` +
                  (acc.byComponent.length > 0
                    ? ` — ${acc.byComponent.map((c) => `${c.component}: ${Math.round(c.accuracy * 100)} %`).join(", ")}`
                    : ""),
            ),
          );
          if (report.proposals.length === 0) {
            out.appendChild(el("p", "muted", "No zone reclassification proposed."));
          }
          for (const p of report.proposals) {
            out.appendChild(
              el(
                "p",
                "ok",
                `proposal: ${p.pattern} — ${p.currentNature} → ${p.suggestedNature} (${p.evidence})`,
              ),
            );
          }
        })
        .catch((e: Error) => out.replaceChildren(el("p", "ko", `error: ${e.message}`)));
    }),
  );
  body.appendChild(out);
  return card("Learning loop — what the app learns from what happened", body);
}

/* ------------------------------------------------------------------ */
/* Tokens & event journal (§17)                                        */
/* ------------------------------------------------------------------ */

export function tokensCard(world: DemoWorld): HTMLElement {
  const body = el("div", "stack");
  const out = el("div", "log", "No token generated yet.");
  body.appendChild(
    button("Generate a personal token", () => {
      void createToken(world.ctx("dev"), "personal").then((created) => {
        out.textContent = `shown ONCE — copy it now:\n${created.token}\nhash: ${created.tokenHash.slice(0, 12)}… (only this is stored)`;
        void refreshEvents(world, eventsBody);
      });
    }),
  );
  body.appendChild(out);
  const eventsBody = el("div", "log", "event journal: (loading…)");
  body.appendChild(el("p", "muted", "Last events (audit journal):"));
  body.appendChild(eventsBody);
  void refreshEvents(world, eventsBody);
  return card("Tokens & event journal", body);
}

async function refreshEvents(world: DemoWorld, target: HTMLElement): Promise<void> {
  const events = await world.stores.events.recent(15);
  target.textContent =
    events.length === 0
      ? "(empty)"
      : events
          .map((e) => `${e.at.slice(11, 19)} ${e.kind}${e.worksiteId ? ` · ${e.worksiteId}` : ""}`)
          .join("\n");
}
