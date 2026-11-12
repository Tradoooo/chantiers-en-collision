/**
 * site/demo/world.ts — the shared demo world used by every interactive
 * section of the public site (github.io/chantiers-en-collision).
 *
 * It is the REAL engine (services + core + in-memory stores) running in the
 * browser: no server, no Jira, no network. The world is seeded with a
 * realistic situation (open worksites, a D4 collision on the exclusive
 * migrations resource, a pending notice, an active reservation, merged
 * history for prediction, real conflicts for the learning loop) and every
 * section reads and mutates that same state, so the page tells one coherent
 * story instead of disconnected widgets.
 */

import type { Identity, MergedTicketHistory, TicketMeta, Worksite } from "../../src/core/types";
import type { Ctx, JiraPort } from "../../src/services/ctx";
import type { Stores } from "../../src/storage/interfaces";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock, type TestClock } from "../../src/testing/clock";

export const REPO_SLUG = "acme/billing";
export const PROJECT_ID = "PROJ";

export interface DemoActor {
  ref: string;
  accountId: string;
  displayName: string;
  kind: "agent" | "human";
  client: string;
  /** Agent session reference (undefined for the human actor). */
  sessionRef?: string;
}

/** The cast of the demo: one pilot driving four agent sessions, plus rivals. */
export const ACTORS: DemoActor[] = [
  { ref: "a1", accountId: "lea@example.com", displayName: "Léa · agent 1", kind: "agent", client: "claude-code", sessionRef: "a1" },
  { ref: "a2", accountId: "lea@example.com", displayName: "Léa · agent 2", kind: "agent", client: "claude-code", sessionRef: "a2" },
  { ref: "a3", accountId: "lea@example.com", displayName: "Léa · agent 3", kind: "agent", client: "claude-code", sessionRef: "a3" },
  { ref: "a4", accountId: "lea@example.com", displayName: "Léa · agent 4", kind: "agent", client: "claude-code", sessionRef: "a4" },
  { ref: "karim", accountId: "karim@example.com", displayName: "Karim · agent", kind: "agent", client: "cursor", sessionRef: "k1" },
  { ref: "dev", accountId: "dev@example.com", displayName: "Dev (no agent)", kind: "human", client: "jira" },
  { ref: "ci", accountId: "ci@example.com", displayName: "CI pipeline", kind: "human", client: "ci" },
];

/** The sprint on the board. */
export const DEMO_TICKETS: TicketMeta[] = [
  { issueKey: "PROJ-88", summary: "Invoice total in cents", components: ["billing"], priorityRank: 2, dueAt: "2026-11-20T00:00:00.000Z" },
  { issueKey: "PROJ-90", summary: "Rename the billing service", components: ["billing"], priorityRank: 4, dueAt: "2026-11-24T00:00:00.000Z" },
  { issueKey: "PROJ-93", summary: "Renumber migrations", components: ["database"], priorityRank: 1, dueAt: "2026-11-18T00:00:00.000Z" },
  { issueKey: "PROJ-95", summary: "Index on invoices", components: ["database"], priorityRank: 3, dueAt: "2026-11-21T00:00:00.000Z" },
  { issueKey: "PROJ-97", summary: "Login rate limit", components: ["auth"], priorityRank: 5, dueAt: "2026-11-28T00:00:00.000Z" },
  { issueKey: "PROJ-101", summary: "total_cents migration", components: ["database", "billing"], priorityRank: 2, dueAt: "2026-11-22T00:00:00.000Z" },
  { issueKey: "PROJ-105", summary: "Translate the invoices screen", components: ["i18n"], priorityRank: 6, dueAt: "2026-12-01T00:00:00.000Z" },
  { issueKey: "PROJ-70", summary: "Refund API (merged)", components: ["billing"], priorityRank: 3 },
];

/** Merged tickets of the last quarter — the basis of predictions (§5, §13). */
export const DEMO_HISTORY: MergedTicketHistory[] = [
  { issueKey: "PROJ-60", components: ["billing"], paths: ["src/billing/invoice.ts", "src/billing/tax.ts"] },
  { issueKey: "PROJ-61", components: ["billing"], paths: ["src/billing/invoice.ts", "src/billing/service.ts"] },
  { issueKey: "PROJ-62", components: ["billing"], paths: ["src/billing/invoice.ts", "src/billing/tax.ts", "src/billing/refund.ts"] },
  { issueKey: "PROJ-63", components: ["database"], paths: ["db/migrations/0101_add_refunds.sql", "db/migrations/0102_refund_index.sql"] },
  { issueKey: "PROJ-64", components: ["auth"], paths: ["src/auth/login.ts", "src/auth/session.ts"] },
  { issueKey: "PROJ-65", components: ["i18n"], paths: ["src/i18n/messages.json"] },
];

export interface DemoWorld {
  stores: Stores;
  clock: TestClock;
  repoSlug: string;
  /** Jira port stub: the demo sprint + merged history. */
  jira: JiraPort;
  /** Ctx for one actor of the cast. */
  ctx(actorRef: string): Ctx;
  /** Id of the demo repository (set by seed()). */
  repoId(): string;
  /** Seed the world (idempotent). */
  seed(): Promise<void>;
  /** Rebuild the world from scratch and notify the sections. */
  reset(): Promise<void>;
  /** Move the clock forward (minutes) and notify the sections. */
  advance(minutes: number): void;
  /** Subscribe to world changes (reset / clock) — returns an unsubscribe fn. */
  subscribe(cb: () => void): () => void;
  /** Notify subscribers (after a section mutated the world). */
  touch(): void;
}

const START = "2026-11-12T09:00:00.000Z";

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

async function seedWorksite(
  world: DemoWorld,
  actorRef: string,
  issueKey: string,
  paths: string[],
  state: "open" | "closed" = "open",
  outcome?: "merged",
): Promise<Worksite> {
  const actor = ACTORS.find((a) => a.ref === actorRef)!;
  const now = world.clock.now();
  const sessionId = actor.sessionRef
    ? (
        await world.stores.sessions.touch({
          accountId: actor.accountId,
          kind: actor.kind,
          client: actor.client,
          sessionRef: actor.sessionRef,
          agentRef: undefined,
          at: now,
        })
      ).id
    : undefined;
  const w = await world.stores.worksites.create({
    issueKey,
    repoId: world.repoId(),
    sessionId,
    accountId: actor.accountId,
    kind: actor.kind,
    branch: `feature/${issueKey}-${actorRef}`,
    state,
    openedAt: now,
    lastActivityAt: now,
    closedAt: state === "closed" ? now : undefined,
    outcome,
    ticket: DEMO_TICKETS.find((t) => t.issueKey === issueKey),
  });
  await world.stores.footprints.add(
    paths.map((path) => ({
      worksiteId: w.id,
      path,
      kind: path.split("/").pop()!.includes(".") ? ("file" as const) : ("dir" as const),
      source: state === "closed" ? ("attested" as const) : ("declared" as const),
      mode: "edit" as const,
      at: now,
    })),
  );
  return w;
}

async function seedWorld(world: DemoWorld): Promise<void> {
  const repo = await world.stores.repos.ensure(PROJECT_ID, REPO_SLUG, "main");
  await world.stores.zones.seedDefaults(repo.id);
  // One team zone: shows that a team zone competes with the default catalog.
  await world.stores.zones.upsert({
    id: `zone-team-billing-${repo.id}`,
    repoId: repo.id,
    name: "billing",
    patterns: ["src/billing/**"],
    nature: "ordinary",
  });
  await world.stores.rules.set({
    projectId: PROJECT_ID,
    order: ["reservation", "incident", "priority", "due", "advance", "first"],
    agentYields: true,
    hardMode: false,
    dormancyHours: 24,
  });

  // Open worksites: Léa's agent 3 renumbers migrations, agent 1 touches the
  // invoice file, Karim works on the auth side, agent 4 wants a migration too.
  const mig = await seedWorksite(world, "a3", "PROJ-93", ["db/migrations/0101_renumber.sql"]);
  await seedWorksite(world, "a1", "PROJ-88", ["src/billing/invoice.ts"]);
  await seedWorksite(world, "karim", "PROJ-97", ["src/auth/login.ts"]);
  await seedWorksite(world, "a4", "PROJ-95", ["db/migrations/0102_index.sql"]);

  // A pending notice from PROJ-88 to the worksite holding the lock.
  await world.stores.notices.post(
    {
      worksiteId: mig.id,
      repoId: repo.id,
      authorAccountId: "lea@example.com",
      issueKey: "PROJ-88",
      paths: ["db/migrations"],
      text: "renaming invoices.total to total_cents — please renumber after me",
      createdAt: world.clock.now(),
    },
    [mig.id],
  );

  // An active reservation on the migrations resource (expires at 11:00).
  await world.stores.reservations.create({
    worksiteId: mig.id,
    repoId: repo.id,
    patterns: ["db/migrations"],
    hard: false,
    reason: "renumbering migrations in one go",
    createdAt: world.clock.now(),
    expiresAt: "2026-11-12T11:00:00.000Z",
  });

  // Merged worksite + its prediction + its attested footprint → accuracy.
  await seedWorksite(world, "dev", "PROJ-70", ["src/billing/invoice.ts", "src/billing/tax.ts"], "closed", "merged");
  await world.stores.predictions.save({
    issueKey: "PROJ-70",
    repoId: repo.id,
    entries: [
      { path: "src/billing/invoice.ts", kind: "file", confidence: 0.8 },
      { path: "src/billing/service.ts", kind: "file", confidence: 0.5 },
    ],
    confidence: 0.65,
    basis: { componentMatch: true, referenceTickets: ["PROJ-60", "PROJ-62"] },
    computedAt: world.clock.now(),
  });

  // Real conflicts in a legacy folder → the learning loop proposes "exclusive".
  for (const p of ["src/legacy-db/schema.sql", "src/legacy-db/seed.sql"]) {
    await world.stores.conflicts.report({
      repoId: repo.id,
      issueKeyA: "PROJ-93",
      issueKeyB: "PROJ-95",
      paths: [p],
      wasDetected: false,
      reportedAt: world.clock.now(),
    });
  }
}

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export function createWorld(): DemoWorld {
  let stores: Stores = createMemoryStores();
  let clock: TestClock = makeClock(START);
  let repoIdValue = "";
  const listeners = new Set<() => void>();

  const world: DemoWorld = {
    get stores() {
      return stores;
    },
    get clock() {
      return clock;
    },
    repoSlug: REPO_SLUG,
    jira: {
      searchIssues: async () => DEMO_TICKETS,
      getIssue: async (issueKey: string) => DEMO_TICKETS.find((t) => t.issueKey === issueKey),
      mergedHistory: async () => DEMO_HISTORY,
    },
    ctx(actorRef: string): Ctx {
      const actor = ACTORS.find((a) => a.ref === actorRef) ?? ACTORS[0]!;
      const identity: Identity = {
        accountId: actor.accountId,
        kind: actor.kind,
        client: actor.client,
        sessionRef: actor.sessionRef,
      };
      return {
        stores,
        now: () => clock.now(),
        identity,
        projectId: PROJECT_ID,
        jira: world.jira,
      };
    },
    repoId: () => repoIdValue,
    async seed(): Promise<void> {
      // The repo id must exist BEFORE the worksites are seeded (they carry it).
      const repo = await stores.repos.ensure(PROJECT_ID, REPO_SLUG, "main");
      repoIdValue = repo.id;
      await seedWorld(world);
    },
    async reset(): Promise<void> {
      stores = createMemoryStores();
      clock = makeClock(START);
      await world.seed();
      world.touch();
    },
    advance(minutes: number): void {
      clock.advance(minutes);
      world.touch();
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    touch(): void {
      for (const cb of listeners) cb();
    },
  };
  return world;
}

/** The world every section of the page shares. */
export const WORLD: DemoWorld = createWorld();
