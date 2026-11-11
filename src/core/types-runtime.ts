/**
 * Domain contracts (2/2) — ingest (hook/CI), tokens/events/rules, UI data
 * shapes, simulation, i18n message ids. Import from "../core/types".
 * Pure TypeScript: NO runtime imports except sibling contract types.
 */

import {
  DEFAULT_DORMANCY_HOURS,
  type ActorKind,
  type Collision,
  type Degree,
  type FootprintCoverage,
  type FootprintEntry,
  type FootprintSource,
  type NeighborInfo,
  type Notice,
  type NoticeView,
  type PathKind,
  type PlanTicket,
  type RepoRecord,
  type Reservation,
  type Verdict,
  type VerdictKind,
  type Worksite,
  type ZoneNature,
} from "./types-domain";
/* ------------------------------------------------------------------ */
/* Ingest — hook and CI (spec §9.3, §10)                               */
/* ------------------------------------------------------------------ */

/** Sanitized hook event: path, session and working dir ONLY (spec §17). */
export interface HookTouchEvent {
  sessionRef: string;
  /** Absolute file path as sent by the client; converted to repo-relative. */
  path: string;
  cwd?: string;
  agentRef?: string;
  agentType?: string;
  /** Repository slug, from the X-Chantier-Repo header (glue-provided). */
  repoSlug?: string;
}

export interface HookOpenEvent {
  sessionRef: string;
  branch: string;
  cwd?: string;
  agentRef?: string;
  /** Repository slug, from the X-Chantier-Repo header (glue-provided). */
  repoSlug?: string;
}

/** What the hook endpoint answers to the agent client. */
export interface HookResponse {
  /** Injected into the agent context (additionalContext). */
  additionalContext?: string;
  /** Hard mode only: deny the edit with a reason. */
  deny?: { reason: string };
}

/** CI input: files changed since the divergence point with the base. */
export interface CiFootprintInput {
  repoSlug: string;
  branch: string;
  baseBranch?: string;
  issueKey?: string;
  files: string[];
  prOpen?: boolean;
  prApproved?: boolean;
}

export interface RealConflict {
  id: string;
  repoId: string;
  worksiteA?: string;
  worksiteB?: string;
  issueKeyA?: string;
  issueKeyB?: string;
  paths: string[];
  /** Did the app see it coming? */
  wasDetected: boolean;
  reportedAt: string;
}

/* ------------------------------------------------------------------ */
/* Tokens, events, rules                                               */
/* ------------------------------------------------------------------ */

export interface HookToken {
  accountId: string;
  /** sha256 hex of the token; the clear value is shown once. */
  tokenHash: string;
  scope: "personal" | "project";
  /** Project-scoped tokens may only send attested footprints. */
  projectId?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface EventRecord {
  seq: number;
  at: string;
  kind: string;
  worksiteId?: string;
  payloadJson?: string;
}

export type EventInput = Omit<EventRecord, "seq">;

/** "Who yields the way" — ordered criteria, adjustable per project. */
export type PriorityCriterion =
  | "reservation"
  | "incident"
  | "priority"
  | "due"
  | "advance"
  | "first";

export interface PriorityRules {
  projectId: string;
  order: PriorityCriterion[];
  /** On a tie, the agent yields to the human (default true). */
  agentYields: boolean;
  /** Hard mode: D4 in reserved/frozen zones → hook denies. */
  hardMode: boolean;
  dormancyHours: number;
}

export const DEFAULT_PRIORITY_RULES: Omit<PriorityRules, "projectId"> = {
  order: ["reservation", "incident", "priority", "due", "advance", "first"],
  agentYields: true,
  hardMode: false,
  dormancyHours: DEFAULT_DORMANCY_HOURS,
};

/** One side of the "who yields" comparison. */
export interface YieldContext {
  worksiteId: string;
  kind: ActorKind;
  hasActiveReservation: boolean;
  incident: boolean;
  priorityRank?: number;
  dueAt?: string;
  /** Advance: 2 = PR open, 1 = active/open, 0 = declared/planned only. */
  advance: 0 | 1 | 2;
  arrivedAt: string;
}

/* ------------------------------------------------------------------ */
/* Panels, map, stats, sprint check (UI data shapes)                   */
/* ------------------------------------------------------------------ */

export interface WorksitePanel {
  issueKey: string;
  repos: {
    repo: RepoRecord;
    worksites: Worksite[];
    footprintsBySource: Record<FootprintSource, FootprintEntry[]>;
    coverage: FootprintCoverage;
    neighbors: NeighborInfo[];
    collisions: Collision[];
    noticesInbox: NoticeView[];
    noticesSent: Notice[];
    reservations: Reservation[];
  }[];
}

export interface MapNode {
  path: string;
  kind: PathKind;
  /** Worksites occupying this path. */
  worksiteIds: string[];
  /** Worst collision degree touching this path. */
  worstDegree?: Degree;
  zoneName?: string;
  zoneNature?: ZoneNature;
}

export interface WorksiteMapData {
  repoSlug: string;
  nodes: MapNode[];
  worksites: (Worksite & { actorLabel: string })[];
}

export interface SprintCheckData {
  tickets: PlanTicket[];
  riskyPairs: {
    a: string;
    b: string;
    degree: Degree;
    path: string;
    zoneName?: string;
  }[];
  hinges: string[];
  suggestedOrder: string[];
  confidence: "high" | "medium" | "low";
  confidenceNote?: string;
}

/** The four numbers of spec §13. */
export interface CollisionStats {
  seenBeforeCode: number;
  seenWhileWorking: number;
  seenAtPr: number;
  missedUntilMerge: number;
  predictionAccuracy?: number;
}

/* ------------------------------------------------------------------ */
/* Simulation console (spec §16.6, CC-15)                              */
/* ------------------------------------------------------------------ */

export type SimulationAction =
  | "declare"
  | "touch"
  | "open"
  | "close"
  | "reserve"
  | "notice"
  | "ci";

export interface SimulationStep {
  actor: string;
  action: SimulationAction;
  input: Record<string, string | number | boolean>;
  expect?: { verdict?: VerdictKind; degree?: Degree };
  note?: string;
}

export interface SimulationScenario {
  key: string;
  title: string;
  description?: string;
  repos: { slug: string; defaultBranch?: string }[];
  actors: {
    ref: string;
    accountId: string;
    displayName: string;
    kind: ActorKind;
    client?: string;
  }[];
  steps: SimulationStep[];
}

export interface SimulationStepResult {
  index: number;
  step: SimulationStep;
  verdict?: Verdict;
  ok: boolean;
  detail?: string;
}

export interface SimulationResult {
  scenarioKey: string;
  results: SimulationStepResult[];
  allOk: boolean;
}

/* ------------------------------------------------------------------ */
/* i18n — message ids (verdict text, spec §8)                          */
/* ------------------------------------------------------------------ */

export type MsgId =
  | "verdict.free"
  | "verdict.caution"
  | "verdict.wait"
  | "verdict.stop"
  | "zone.exclusive"
  | "zone.hotspot"
  | "zone.frozen"
  | "zone.ordinary"
  | "label.verdict"
  | "label.collision"
  | "label.neighbor"
  | "label.reason"
  | "label.neighborNotice"
  | "label.todo"
  | "label.resume"
  | "tag.probable"
  | "tag.sameTicket"
  | "tag.samePilot"
  | "tag.prOpen"
  | "tag.prApproved"
  | "tag.activeAgo"
  | "tag.agentOf"
  | "tag.session"
  | "reason.exclusive"
  | "reason.frozen"
  | "reason.reserved"
  | "reason.sameFile"
  | "reason.deleteRename"
  | "reason.sameDir"
  | "reason.sameZone"
  | "reason.contract"
  | "advice.waitForMerge"
  | "advice.workOutside"
  | "advice.readNeighbor"
  | "advice.coordinate"
  | "advice.redeclare"
  | "advice.free"
  | "advice.hardDenied";

export type MessageDict = Record<MsgId, string>;

export type Locale = "en" | "fr";
