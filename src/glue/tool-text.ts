/**
 * glue/tool-text — the `text` field every MCP tool returns next to its
 * structured data (spec §8 "Forme de la réponse", §15).
 * Owner: workstream I (glue). Pure: no @forge/*, no I/O, so it is unit-testable.
 *
 * Wording reuses `src/i18n` (rule 7): labels and tags come from the frozen
 * dictionaries; only neutral glue summaries are written here, in English (the
 * submission language). Verdict text itself is produced by `core/verdict` and
 * passed through untouched.
 */

import type {
  CollisionPhase,
  CollisionState,
  Degree,
  FootprintPrediction,
  Locale,
  NeighborInfo,
  Notice,
  RealConflict,
  Reservation,
  ReservationResult,
  ResolutionChoice,
  ResolutionOutcome,
  TicketMeta,
  WavePlan,
  Worksite,
  WorksitePanel,
} from "../core/types";
import { t } from "../i18n/format";
import { minutesBetween } from "../core/time";

/** A collision with both sides resolved to neighbour info (glue enrichment). */
export interface CollisionRow {
  collisionId: string;
  degree: Degree;
  phase: CollisionPhase;
  state: CollisionState;
  path: string;
  probable?: boolean;
  resolution?: ResolutionChoice;
  a?: NeighborInfo;
  b?: NeighborInfo;
}

const NONE = "—";

function bullet(line: string): string {
  return `- ${line}`;
}

function tagsOf(n: NeighborInfo, locale: Locale, now: string): string {
  const tags: string[] = [n.state];
  if (n.prOpen === true) tags.push(t(locale, "tag.prOpen"));
  if (n.prApproved === true) tags.push(t(locale, "tag.prApproved"));
  tags.push(t(locale, "tag.activeAgo", { mins: minutesBetween(n.lastActivityAt, now) }));
  if (n.sessionRef !== undefined) tags.push(t(locale, "tag.session", { session: n.sessionRef }));
  return tags.join(" · ");
}

function neighborLine(n: NeighborInfo, locale: Locale, now: string): string {
  const head = bullet(`${n.issueKey} · ${n.actorLabel} · ${tagsOf(n, locale, now)}`);
  return n.notice === undefined ? head : `${head}\n  ${t(locale, "label.neighborNotice")}: “${n.notice}”`;
}

/** "who-touches" / neighbour lists. */
export function neighborsText(rows: NeighborInfo[], locale: Locale, now: string): string {
  if (rows.length === 0) return "no worksite on these paths right now";
  return rows.map((n) => neighborLine(n, locale, now)).join("\n");
}

function collisionLine(row: CollisionRow, locale: Locale): string {
  const sides = [row.a?.issueKey ?? NONE, row.b?.issueKey ?? NONE].join(" × ");
  const probable = row.probable === true ? ` · ${t(locale, "tag.probable")}` : "";
  const resolved = row.resolution === undefined ? "" : ` · ${row.state}: ${row.resolution}`;
  return bullet(`D${row.degree} · ${sides} · ${row.path} · ${row.phase}${probable}${resolved}`);
}

/** "list-collisions" / enriched collision lists. */
export function collisionsText(rows: CollisionRow[], locale: Locale): string {
  if (rows.length === 0) return `no open ${t(locale, "label.collision")}`;
  const head = `${rows.length} ${t(locale, "label.collision")}(s):`;
  return [head, ...rows.map((row) => collisionLine(row, locale))].join("\n");
}

/** "get-worksite": one line per repo of the panel, then the neighbours. */
export function panelText(panel: WorksitePanel, locale: Locale, now: string): string {
  const lines: string[] = [`worksite panel · ${panel.issueKey}`];
  for (const entry of panel.repos) {
    const coverage = Object.entries(entry.coverage)
      .map(([source, count]) => `${source}:${count}`)
      .join(" ");
    lines.push(
      bullet(
        `${entry.repo.slug} · ${entry.worksites.length} worksite(s) · ` +
          `${entry.collisions.length} ${t(locale, "label.collision")}(s) · ` +
          `${entry.noticesInbox.length} notice(s) in · ${coverage || "no footprint"}`,
      ),
    );
    lines.push(...entry.neighbors.map((n) => neighborLine(n, locale, now)));
  }
  return lines.length === 1 ? `${lines[0]}\nno worksite declared yet` : lines.join("\n");
}

/** "predict-footprint": confidence first, never blocking (spec §5). */
export function predictionText(prediction: FootprintPrediction | undefined, locale: Locale): string {
  if (prediction === undefined || prediction.entries.length === 0) {
    return "no prediction available for this ticket (no merged reference yet) — predictions never block";
  }
  const paths = prediction.entries
    .slice(0, 10)
    .map((entry) => `${entry.path} (${entry.confidence})`)
    .join(", ");
  const basis =
    prediction.basis.referenceTickets.length > 0
      ? ` · references: ${prediction.basis.referenceTickets.join(", ")}`
      : "";
  return (
    `predicted footprint · confidence ${prediction.confidence}${basis}\n` +
    `${paths}\n${t(locale, "tag.probable")} — capped at D1, it never blocks a declaration`
  );
}

/** "list-clear-work": what an idle agent can start now. */
export function ticketsText(tickets: TicketMeta[], heading: string): string {
  if (tickets.length === 0) return `${heading}: none right now`;
  const lines = tickets.map((ticket) => {
    const due = ticket.dueAt === undefined ? "" : ` · due ${ticket.dueAt}`;
    const components = ticket.components.length > 0 ? ` · ${ticket.components.join(",")}` : "";
    return bullet(`${ticket.issueKey} ${ticket.summary ?? ""}${components}${due}`.trimEnd());
  });
  return [`${heading} (${tickets.length}):`, ...lines].join("\n");
}

/** "plan-parallel-work": the wave plan of spec §9.5. */
export function wavePlanText(plan: WavePlan): string {
  const lines: string[] = [];
  plan.waves.forEach((wave, index) => {
    const hinge = index === 0 && plan.hinges.length > 0 ? " (hinges, alone first)" : "";
    lines.push(bullet(`wave ${index + 1}${hinge}: ${wave.join(", ") || NONE}`));
  });
  if (plan.hinges.length > 0) lines.push(bullet(`hinges: ${plan.hinges.join(", ")}`));
  for (const pair of plan.watchPairs) {
    lines.push(bullet(`watch ${pair.a} × ${pair.b}: ${pair.why}`));
  }
  lines.push(
    bullet(
      `confidence ${plan.confidence}${plan.confidenceNote === undefined ? "" : ` — ${plan.confidenceNote}`}`,
    ),
  );
  return lines.join("\n");
}

/** "reserve-zone": the reservation, or the motivated refusal. */
export function reservationText(result: ReservationResult, locale: Locale, now: string): string {
  if ("refused" in result) {
    const until =
      result.conflicting === undefined
        ? ""
        : ` (free in ${minutesBetween(now, result.conflicting.expiresAt)} min)`;
    return `${t(locale, "verdict.wait")}: ${result.reason}${until}`;
  }
  const reservation: Reservation = result;
  return (
    `reserved until ${reservation.expiresAt}` +
    ` · ${reservation.patterns.length} pattern(s)${reservation.hard ? " · hard" : ""}` +
    `\n${bullet(reservation.patterns.join(", "))}`
  );
}

/** "post-notice": who will read it, and when (once per session, §9.4). */
export function noticeText(notice: Notice, recipients: NeighborInfo[], locale: Locale): string {
  if (recipients.length === 0) {
    return `notice ${notice.id} recorded — no neighbour on these paths right now`;
  }
  const names = recipients.map((r) => `${r.issueKey} (${r.actorLabel})`).join(", ");
  return `notice ${notice.id} will reach ${recipients.length} neighbour(s): ${names}\n` +
    `${t(locale, "label.neighborNotice")}: “${notice.text}”`;
}

/** "resolve-collision": the recorded outcome and what it created. */
export function resolutionText(outcome: ResolutionOutcome, locale: Locale): string {
  const lines = [
    bullet(
      `${t(locale, "label.collision")} ${outcome.collisionId} · ${outcome.choice}` +
        `${outcome.recorded ? "" : " · NOT recorded"}`,
    ),
  ];
  if (outcome.yieldsWorksiteId !== undefined) lines.push(bullet(`yields: ${outcome.yieldsWorksiteId}`));
  if (outcome.linkToCreate !== undefined) {
    lines.push(
      bullet(`link: ${outcome.linkToCreate.blockedIssueKey} is blocked by ${outcome.linkToCreate.blockerIssueKey}`),
    );
  }
  if (outcome.noticeSent === true) lines.push(bullet("notice sent to the neighbour"));
  if (outcome.splitTicketDraft !== undefined) {
    lines.push(bullet(`split ticket draft: ${outcome.splitTicketDraft.summary}`));
  }
  if (outcome.releasedWorksiteIds !== undefined && outcome.releasedWorksiteIds.length > 0) {
    lines.push(bullet(`released: ${outcome.releasedWorksiteIds.join(", ")}`));
  }
  return lines.join("\n");
}

/** "close-worksite": what was closed and who is released (spec §8). */
export function closeText(closed: Worksite[], released: NeighborInfo[], locale: Locale, now: string): string {
  const closedLine =
    closed.length === 0
      ? "no open worksite to close"
      : bullet(`closed ${closed.length} worksite(s): ${closed.map((w) => `${w.issueKey} ${w.outcome ?? ""}`.trimEnd()).join(", ")}`);
  const releasedLine =
    released.length === 0
      ? `${t(locale, "advice.free")}`
      : `${released.length} neighbour(s) released:\n${neighborsText(released, locale, now)}`;
  return `${closedLine}\n${releasedLine}`;
}

/** "report-conflict": did the app see it coming? (spec §13) */
export function conflictText(conflict: RealConflict): string {
  const seen = conflict.wasDetected
    ? "the app had seen this coming (an open collision covered it)"
    : "MISSED: no open collision covered these paths — this feeds the four numbers";
  return `${bullet(`conflict ${conflict.id} on ${conflict.paths.join(", ")}`)}\n${bullet(seen)}`;
}
