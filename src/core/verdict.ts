/**
 * core/verdict — verdict kind, reason/advice wording and the formatted
 * response (spec §7, §8). All user-facing strings go through src/i18n.
 */

import { dictFor, format } from "../i18n/format";
import { minutesBetween } from "./time";
import type {
  Locale,
  MsgId,
  NeighborInfo,
  VerdictCollisionInfo,
  VerdictKind,
} from "./types";

/**
 * Overall verdict from the worst collision:
 * none/D0 → free · D1–D2 → caution · D3 → wait · D4 → wait (stop in hard
 * mode) · D5 → caution (coordinate, lot C).
 */
export function verdictKindFor(
  collisions: VerdictCollisionInfo[],
  hardMode: boolean,
): VerdictKind {
  if (collisions.length === 0) return "free";
  let max = 0;
  for (const c of collisions) if (c.degree > max) max = c.degree;
  if (max === 0) return "free";
  if (max <= 2) return "caution";
  if (max === 3) return "wait";
  if (max === 4) return hardMode ? "stop" : "wait";
  return "caution";
}

/** "agent of lea@example.com (session 3f2a)" or the plain account id. */
export function neighborLabel(n: NeighborInfo, locale: Locale): string {
  const dict = dictFor(locale);
  if (n.kind === "agent") {
    return format(dict, "tag.agentOf", {
      name: n.accountId,
      session: n.sessionRef ?? "—",
    });
  }
  return n.accountId;
}

export interface ReasonParams {
  degree: number;
  zoneNature: string;
  zoneName?: string;
  /** ISO expiry of a reservation / freeze, when relevant. */
  until?: string;
  reservedByIssueKey?: string;
  locale: Locale;
}

function shortTime(iso?: string): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

/** The "reason" line of a collision block. */
export function reasonForCollision(p: ReasonParams): string {
  const dict = dictFor(p.locale);
  const zone = p.zoneName ?? "";
  switch (p.degree) {
    case 4:
      if (p.reservedByIssueKey) {
        return format(dict, "reason.reserved", {
          zone,
          until: shortTime(p.until),
          issueKey: p.reservedByIssueKey,
        });
      }
      if (p.zoneNature === "frozen") {
        return format(dict, "reason.frozen", { zone, until: shortTime(p.until) });
      }
      return format(dict, "reason.exclusive", { zone });
    case 3:
      return dict["reason.deleteRename"];
    case 2:
      return dict["reason.sameFile"];
    case 1:
      return dict["reason.sameDir"];
    case 5:
      return dict["reason.contract"];
    default:
      return format(dict, "reason.sameZone", { zone });
  }
}

export interface AdviceParams {
  degree: number;
  zoneNature: string;
  zoneName?: string;
  neighborIssueKey: string;
  /** Neighbour PR is open → advise waiting for the merge, it is close. */
  neighborPrOpen?: boolean;
  hardMode: boolean;
  locale: Locale;
}

/** The "what to do" line of a collision block. */
export function adviceForCollision(p: AdviceParams): string {
  const dict = dictFor(p.locale);
  const zone = p.zoneName ?? "";
  const waitMerge = format(dict, "advice.waitForMerge", { issueKey: p.neighborIssueKey });
  if (p.hardMode && p.degree === 4) {
    return format(dict, "advice.hardDenied", {
      reason: reasonForCollision({ ...p, zoneNature: p.zoneNature }),
    });
  }
  switch (p.degree) {
    case 4:
      return p.neighborPrOpen ? waitMerge : format(dict, "advice.workOutside", { zone });
    case 3:
    case 5:
      return format(dict, "advice.coordinate", { issueKey: p.neighborIssueKey });
    case 2:
      return p.neighborPrOpen ? waitMerge : dict["advice.readNeighbor"];
    case 1:
      return dict["advice.readNeighbor"];
    default:
      return dict["advice.free"];
  }
}

/* ------------------------------------------------------------------ */
/* Formatted verdict text (spec §8)                                    */
/* ------------------------------------------------------------------ */

const MAX_BLOCKS = 3;

/** "neighbor : PROJ-88 · agent of Léa (session 3f2a) · PR open · active 4 min ago" */
function neighborLine(n: NeighborInfo, locale: Locale, now: string): string {
  const dict = dictFor(locale);
  const stateTags: string[] = [];
  if (n.prApproved) stateTags.push(dict["tag.prApproved"]);
  else if (n.prOpen) stateTags.push(dict["tag.prOpen"]);
  stateTags.push(format(dict, "tag.activeAgo", { mins: minutesBetween(n.lastActivityAt, now) }));
  return `${format(dict, "label.neighbor", {})} : ${[n.issueKey, n.actorLabel, ...stateTags].join(" · ")}`;
}

function quotes(locale: Locale): [string, string] {
  return locale === "fr" ? ["« ", " »"] : ['"', '"'];
}

function collisionBlock(
  c: VerdictCollisionInfo,
  locale: Locale,
  now: string,
): string {
  const dict = dictFor(locale);
  const [qo, qc] = quotes(locale);
  const lines: string[] = [];

  const natureId =
    c.zoneNature === "exclusive"
      ? "zone.exclusive"
      : c.zoneNature === "hotspot"
        ? "zone.hotspot"
        : c.zoneNature === "frozen"
          ? "zone.frozen"
          : ("zone.ordinary" as MsgId);
  let collisionLine = `D${c.degree} · ${c.path}`;
  if (c.zoneName) {
    collisionLine += ` · ${format(dict, natureId, {})} ${qo}${c.zoneName}${qc}`;
  }
  const tags: string[] = [];
  if (c.probable) tags.push(dict["tag.probable"]);
  if (c.sameTicket) tags.push(dict["tag.sameTicket"]);
  if (c.samePilot) tags.push(dict["tag.samePilot"]);
  if (tags.length > 0) collisionLine += ` · ${tags.join(" · ")}`;
  lines.push(`${format(dict, "label.collision", {})} : ${collisionLine}`);

  lines.push(neighborLine(c.neighbor, locale, now));

  lines.push(`${format(dict, "label.reason", {})} : ${c.reason}`);
  if (c.neighbor.notice) {
    lines.push(`${format(dict, "label.neighborNotice", {})} : ${qo}${c.neighbor.notice}${qc}`);
  }
  lines.push(`${format(dict, "label.todo", {})} : ${c.advice}`);
  if (c.estimatedResumeMinutes !== undefined) {
    lines.push(
      `${format(dict, "label.resume", {})} : ${c.estimatedResumeMinutes} min`,
    );
  }
  return lines.join("\n");
}

/**
 * The full verdict text block, exactly shaped like spec §8:
 * verdict line, up to three collision blocks separated by "---", then the
 * pending notices. No verdict without a named neighbour, a cited path and
 * a course of action.
 */
export function formatVerdictText(
  v: {
    kind: VerdictKind;
    collisions: VerdictCollisionInfo[];
    notices: { fromIssueKey: string; text: string }[];
  },
  locale: Locale,
  now: string,
): string {
  const dict = dictFor(locale);
  const parts: string[] = [
    `${format(dict, "label.verdict", {})} : ${dict[`verdict.${v.kind}` as MsgId]}`,
  ];
  const blocks = v.collisions
    .slice()
    .sort((a, b) => b.degree - a.degree)
    .slice(0, MAX_BLOCKS)
    .map((c) => collisionBlock(c, locale, now));
  if (blocks.length > 0) parts.push(blocks.join("\n---\n"));
  for (const n of v.notices) {
    parts.push(`[${n.fromIssueKey}] ${quotes(locale)[0]}${n.text}${quotes(locale)[1]}`);
  }
  return parts.join("\n");
}
