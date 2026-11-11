/**
 * Domain contracts — single source of truth for every module.
 *
 * "Chantiers en collision" (Worksites in collision): Jira knows at all times
 * who is working on which part of the code, people and agents alike. Every
 * work in progress has a footprint on the repository; any overlap is flagged
 * before the first line is written, and the app says what to do next.
 *
 * Pure TypeScript: NO runtime imports (no @forge/*, no node:*). Types and
 * constants only. Every module (core, storage, services, ui, resolvers)
 * imports from here.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Default inactivity delay before a worksite becomes dormant (hours). */
export const DEFAULT_DORMANCY_HOURS = 24;
/** A dormant worksite auto-closes after this many days. */
export const DORMANT_CLOSE_DAYS = 7;
/** Default reservation duration (minutes). */
export const DEFAULT_RESERVATION_MINUTES = 120;
/** Hard cap for any reservation (minutes) — "nothing eternal". */
export const MAX_RESERVATION_MINUTES = 1440;
/** Above this many paths in one declaration, suggest a freeze instead. */
export const FREEZE_SUGGESTION_THRESHOLD = 50;

/* ------------------------------------------------------------------ */
/* Paths and zones                                                     */
/* ------------------------------------------------------------------ */

/** How a footprint entry should be interpreted. */
export type PathKind = "file" | "dir" | "pattern";

/** Zone natures (spec §6). */
export type ZoneNature =
  | "ordinary"
  | "exclusive"
  | "hotspot"
  | "frozen"
  | "out-of-scope";

/** A named part of a repository, defined by path patterns, with a nature. */
export interface Zone {
  id: string;
  repoId: string;
  name: string;
  /** Glob patterns: `**` (any depth), `*` (segment), `?` (char). */
  patterns: string[];
  nature: ZoneNature;
  /** Optional Jira component link — first basis for prediction. */
  componentId?: string;
  /** Frozen zones only: ISO dates. */
  frozenFrom?: string;
  frozenTo?: string;
}

/** A repository registered for a Jira project. */
export interface RepoRecord {
  id: string;
  projectId: string;
  provider: "bitbucket" | "github" | "gitlab" | "other";
  /** e.g. "acme/billing" — unique per project. */
  slug: string;
  defaultBranch: string;
}

/* ------------------------------------------------------------------ */
/* Actors and sessions                                                 */
/* ------------------------------------------------------------------ */

/** A person, or an agent session (an agent always belongs to its pilot). */
export type ActorKind = "human" | "agent";

export interface ActorSession {
  id: string;
  /** Pilot account — for an agent, the human driving it. */
  accountId: string;
  kind: ActorKind;
  /** "claude-code", "mcp", "ci", "manual", ... */
  client: string;
  sessionRef?: string;
  /** Sub-agent id (lot S). */
  agentRef?: string;
  parentSessionId?: string;
  firstSeen: string;
  lastSeen: string;
}

/** Caller identity. ALWAYS derived from the auth context or token, NEVER
 *  from tool inputs (spec §9.6, §17). */
export interface Identity {
  accountId: string;
  kind: ActorKind;
  client: string;
  sessionRef?: string;
  agentRef?: string;
}

/* ------------------------------------------------------------------ */
/* Tickets and worksites                                               */
/* ------------------------------------------------------------------ */

export type WorksiteState =
  | "planned"
  | "open"
  | "active"
  | "paused"
  | "review"
  | "dormant"
  | "closed";

export type WorksiteOutcome =
  | "merged"
  | "abandoned"
  | "done"
  | "expired"
  | undefined;

/** Ticket metadata snapshot used by prediction and by "who yields". */
export interface TicketMeta {
  issueKey: string;
  issueId?: string;
  summary?: string;
  /** Lower = more urgent (Jira priority rank). */
  priorityRank?: number;
  /** Linked to an open incident. */
  incident?: boolean;
  dueAt?: string;
  components: string[];
  status?: string;
}

/** The work in progress of one actor, for one ticket, in one repository. */
export interface Worksite {
  id: string;
  issueKey: string;
  issueId?: string;
  repoId: string;
  /** Actor session (agents: one session = one worksite). */
  sessionId?: string;
  accountId: string;
  kind: ActorKind;
  branch?: string;
  state: WorksiteState;
  prOpen?: boolean;
  prApproved?: boolean;
  openedAt: string;
  lastActivityAt: string;
  closedAt?: string;
  outcome?: WorksiteOutcome;
  ticket?: TicketMeta;
  /** Sub-worksite of a parent agent session (lot S). */
  parentWorksiteId?: string;
}

/* ------------------------------------------------------------------ */
/* Footprints                                                          */
/* ------------------------------------------------------------------ */

/** The four sources of a footprint (spec §5). */
export type FootprintSource =
  | "predicted"
  | "declared"
  | "observed"
  | "attested";

export type FootprintMode = "edit" | "create" | "delete" | "rename";

export interface FootprintEntry {
  worksiteId: string;
  /** Normalized, relative to the repo root. No leading "./" or "/". */
  path: string;
  kind: PathKind;
  source: FootprintSource;
  mode: FootprintMode;
  firstAt: string;
  lastAt: string;
  /** Observed outside what was declared — the gap is noted (spec §5). */
  declaredMismatch?: boolean;
}

/** Input for adding entries; timestamps filled by the store. */
export type FootprintEntryInput = Omit<
  FootprintEntry,
  "firstAt" | "lastAt"
> & { at?: string };

/** Which sources cover a worksite (panel shows supposed/announced/proven). */
export type FootprintCoverage = Partial<Record<FootprintSource, number>>;

/* ------------------------------------------------------------------ */
/* Collisions                                                          */
/* ------------------------------------------------------------------ */

/** Collision degree D0..D5 (spec §7). */
export type Degree = 0 | 1 | 2 | 3 | 4 | 5;

/** When the collision was seen — the "four numbers" of spec §13. */
export type CollisionPhase = "before-code" | "live" | "pr" | "missed";

export type CollisionState = "open" | "resolved" | "superseded";

/** The six outcomes of a collision (spec §8). */
export type ResolutionChoice =
  | "wait"
  | "sequence"
  | "coordinate"
  | "split"
  | "merge"
  | "override";

/** One collision per pair of worksites and per zone (spec §17 step 5). */
export interface Collision {
  id: string;
  repoId: string;
  /** Normalized ordering: worksiteA < worksiteB (by id). */
  worksiteA: string;
  worksiteB: string;
  zoneId?: string;
  /** Representative overlapping path. */
  path: string;
  /** Degree after modulation. */
  degree: Degree;
  /** Degree before modulation (hotspot / dormant / predicted). */
  rawDegree: Degree;
  phase: CollisionPhase;
  state: CollisionState;
  resolution?: ResolutionChoice;
  resolvedBy?: string;
  reason?: string;
  detectedAt: string;
  /** At least one side is prediction-only → capped at D1. */
  probable?: boolean;
}

/** Draft used to upsert a collision (id/state filled by the store). */
export type CollisionDraft = Omit<
  Collision,
  "id" | "state" | "detectedAt"
> & { detectedAt?: string; state?: CollisionState };

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

/** libre / prudence / attendre / stop (spec §4). */
export type VerdictKind = "free" | "caution" | "wait" | "stop";

/** Everything the panel/agent needs about one neighbouring worksite. */
export interface NeighborInfo {
  worksiteId: string;
  issueKey: string;
  accountId: string;
  /** Human label, e.g. "agent of Léa (session 3f2a)". */
  actorLabel: string;
  kind: ActorKind;
  client?: string;
  sessionRef?: string;
  state: WorksiteState;
  lastActivityAt: string;
  prOpen?: boolean;
  prApproved?: boolean;
  branch?: string;
  /** Latest notice posted by that worksite, if any. */
  notice?: string;
}

export interface VerdictCollisionInfo {
  collisionId: string;
  degree: Degree;
  zoneName?: string;
  zoneNature: ZoneNature;
  path: string;
  neighbor: NeighborInfo;
  /** Human/agent-readable reason ("one migration at a time"). */
  reason: string;
  /** What to do instead. */
  advice: string;
  estimatedResumeMinutes?: number;
  /** Two sessions on the same ticket. */
  sameTicket?: boolean;
  /** Agents driven by the same pilot. */
  samePilot?: boolean;
  /** Prediction-only side: degree capped, information labelled "probable". */
  probable?: boolean;
  /** Hard mode would deny edits here. */
  hardDeny?: boolean;
}

export interface Verdict {
  kind: VerdictKind;
  collisions: VerdictCollisionInfo[];
  /** Notices delivered with this response (once per session). */
  pendingNotices: NoticeView[];
  /** Formatted text block (spec §8 "Forme de la réponse"). */
  text: string;
  /** Suggested freeze when a declaration is huge (spec §21). */
  freezeSuggestion?: { paths: number; zoneName?: string };
}

/* ------------------------------------------------------------------ */
/* Notices ("courrier de chantier")                                    */
/* ------------------------------------------------------------------ */

export interface Notice {
  id: string;
  worksiteId: string;
  repoId: string;
  authorAccountId: string;
  issueKey: string;
  paths: string[];
  text: string;
  createdAt: string;
}

/** A notice as seen by a recipient. */
export interface NoticeView {
  noticeId: string;
  fromIssueKey: string;
  fromActorLabel: string;
  paths: string[];
  text: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

export interface Reservation {
  id: string;
  worksiteId: string;
  repoId: string;
  patterns: string[];
  /** Hard mode: hook denies edits (spec §9.3). */
  hard: boolean;
  reason?: string;
  createdAt: string;
  expiresAt: string;
  releasedAt?: string;
}

export interface ReservationRefusal {
  refused: true;
  reason: string;
  conflicting?: Reservation;
}

export type ReservationResult = Reservation | ReservationRefusal;

/* ------------------------------------------------------------------ */
/* Resolution outcomes (spec §8)                                       */
/* ------------------------------------------------------------------ */

export interface ResolutionOutcome {
  collisionId: string;
  choice: ResolutionChoice;
  /** Who must wait (worksite id), when choice = "wait" | "sequence". */
  yieldsWorksiteId?: string;
  /** "is blocked by" link to create between tickets (sequence). */
  linkToCreate?: { blockedIssueKey: string; blockerIssueKey: string };
  /** Notice sent to the neighbour (coordinate). */
  noticeSent?: boolean;
  /** Draft ticket prepared by the app (split). */
  splitTicketDraft?: { summary: string; description: string; paths: string[] };
  /** Neighbours released (merge/close). */
  releasedWorksiteIds?: string[];
  recorded: boolean;
}

/* ------------------------------------------------------------------ */
/* Prediction                                                          */
/* ------------------------------------------------------------------ */

export interface PredictedPath {
  path: string;
  kind: PathKind;
  /** 0..1 */
  confidence: number;
}

export interface FootprintPrediction {
  issueKey: string;
  repoId: string;
  entries: PredictedPath[];
  /** Overall confidence 0..1. */
  confidence: number;
  basis: {
    componentMatch: boolean;
    referenceTickets: string[];
  };
  computedAt: string;
}

/** A merged ticket, used as prediction history. */
export interface MergedTicketHistory {
  issueKey: string;
  components: string[];
  summary?: string;
  paths: string[];
}

/* ------------------------------------------------------------------ */
/* Planning — waves (spec §9.5)                                        */
/* ------------------------------------------------------------------ */

export interface PlanTicket {
  issueKey: string;
  summary?: string;
  components: string[];
  priorityRank?: number;
  dueAt?: string;
  incident?: boolean;
  /** Predicted or already declared footprint. */
  entries: { path: string; kind: PathKind; source: FootprintSource }[];
}

export interface WavePlan {
  /** Issue keys per wave; wave 0 = hinges, alone and first. */
  waves: string[][];
  /** Hinge tickets: footprint crosses many others. */
  hinges: string[];
  /** Pairs sharing a hotspot file — overlap expected but worth a look. */
  watchPairs: { a: string; b: string; why: string }[];
  confidence: "high" | "medium" | "low";
  confidenceNote?: string;
}

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
