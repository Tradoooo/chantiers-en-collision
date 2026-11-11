/**
 * forge-context — builds the `Ctx` every service needs, from the Forge runtime.
 * Owner: workstream I (glue). The ONLY place (with src/glue/**) allowed to
 * import `@forge/*` and `node:crypto`.
 *
 * Identity (spec §9.6, §17 step 1) — never from a tool input:
 *  - MCP action / UI screen  → `context.accountId` given by Forge;
 *  - web trigger (hook / CI) → the VERIFIED Bearer token (services/tokens);
 *  - trigger / scheduled     → no user at all: the synthetic `system` account.
 * The `session` input of a tool only *distinguishes* sessions (Identity.
 * sessionRef); it grants nothing: the account always comes from the context.
 *
 * Time: `now()` is the real clock here; tests and the simulation console inject
 * `src/testing/clock.makeClock` instead (services never call Date themselves).
 */

import { createHash, randomBytes } from "node:crypto";
import type { ActorKind, HookToken, Identity } from "./core/types";
import type { Ctx, JiraPort } from "./services/ctx";
import { makeJiraPort } from "./glue/jira-port";
import { createForgeStores } from "./storage/forge";
import { ensureSchema } from "./storage/schema";
import type { Stores } from "./storage/interfaces";

/** Account used when Forge gives no user (triggers, scheduled jobs). */
export const SYSTEM_ACCOUNT_ID = "system";
/** Project bucket when no Jira project can be derived. */
export const DEFAULT_PROJECT_ID = "default";

/** The slice of the Forge invocation context the glue reads (and nothing more). */
export interface ForgeInvocationContext {
  accountId?: string;
  principal?: { accountId?: string };
  cloudId?: string;
  installContext?: string;
  projectKey?: string;
  issueKey?: string;
  /** Actions invoked from a Jira issue carry the product context here. */
  jira?: { projectKey?: string; issueKey?: string; projectId?: string | number };
  [key: string]: unknown;
}

export interface BuildCtxOptions {
  /** Forge invocation context (MCP action, UI screen). Identity source #1. */
  context?: ForgeInvocationContext;
  /** Verified hook/CI token. Identity source #2 — never the raw request. */
  token?: HookToken;
  /** Explicit project key; else derived from the context, else the issue key. */
  projectId?: string;
  /** Ticket of the call, used to derive the project when nothing else says it. */
  issueKey?: string;
  /** "mcp", "hook", "ci", "trigger"… recorded on the session. */
  client?: string;
  /** Session reference — distinguishes sessions, grants no right (§9.6). */
  sessionRef?: string;
  /** Sub-agent id (lot S). */
  agentRef?: string;
  /** Force the actor kind; inferred from agentRef/sessionRef otherwise. */
  kind?: ActorKind;
  /** Test/simulation override: memory stores, no schema, no Jira port. */
  stores?: Stores;
  jira?: JiraPort;
  now?: () => string;
  randomHex?: (bytes: number) => string;
  sha256?: (value: string) => string;
}

/* ------------------------------------------------------------------ */
/* Crypto (tokens: services/tokens use ctx.randomHex / ctx.sha256)      */
/* ------------------------------------------------------------------ */

export function cryptoRandomHex(bytes: number): string {
  return randomBytes(Math.max(1, bytes)).toString("hex");
}

export function cryptoSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function realNow(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Identity and project                                                 */
/* ------------------------------------------------------------------ */

function accountIdOf(context?: ForgeInvocationContext): string | undefined {
  return context?.accountId ?? context?.principal?.accountId;
}

/**
 * An agent is "pilot account + client + session" (§9.6): a session reference or
 * a sub-agent id means an agent session; without them the caller is the human.
 */
function kindOf(options: BuildCtxOptions): ActorKind {
  if (options.kind !== undefined) return options.kind;
  return options.agentRef !== undefined || options.sessionRef !== undefined ? "agent" : "human";
}

function clientOf(options: BuildCtxOptions): string {
  if (options.client !== undefined && options.client !== "") return options.client;
  if (options.token !== undefined) return options.token.scope === "project" ? "ci" : "hook";
  return options.context !== undefined ? "forge" : "system";
}

/** Identity of the caller: context account, else verified token, else system. */
export function identityFrom(options: BuildCtxOptions): Identity {
  const accountId =
    options.token?.accountId ?? accountIdOf(options.context) ?? SYSTEM_ACCOUNT_ID;
  const identity: Identity = { accountId, kind: kindOf(options), client: clientOf(options) };
  if (options.sessionRef !== undefined) identity.sessionRef = options.sessionRef;
  if (options.agentRef !== undefined) identity.agentRef = options.agentRef;
  return identity;
}

/** "PROJ-88" → "PROJ"; the Jira project keys the repos, zones and rules. */
export function projectOfIssueKey(issueKey?: string): string | undefined {
  const match = issueKey === undefined ? null : /^([A-Za-z][A-Za-z0-9_]*)-\d+/.exec(issueKey.trim());
  return match === null ? undefined : match[1].toUpperCase();
}

function projectKeyOfContext(context?: ForgeInvocationContext): string | undefined {
  return context?.projectKey ?? context?.jira?.projectKey;
}

export function projectIdFor(options: BuildCtxOptions): string {
  return (
    options.projectId?.trim() ||
    projectKeyOfContext(options.context) ||
    projectOfIssueKey(options.issueKey) ||
    DEFAULT_PROJECT_ID
  );
}

/* ------------------------------------------------------------------ */
/* Stores + schema (idempotent, once per container)                     */
/* ------------------------------------------------------------------ */

let storesMemo: Promise<Stores> | undefined;

/**
 * Forge SQL stores, with `ensureSchema()` applied first. The DDL is idempotent
 * (`IF NOT EXISTS` + the migration runner's own ledger), so re-running it on a
 * warm container is harmless; the memo only avoids paying for it on every
 * invocation of the same container.
 */
async function forgeStores(): Promise<Stores> {
  if (storesMemo === undefined) {
    storesMemo = (async () => {
      await ensureSchema();
      return createForgeStores();
    })().catch((error: unknown) => {
      storesMemo = undefined; // a failed cold start must be retried, not cached
      throw error;
    });
  }
  return storesMemo;
}

/* ------------------------------------------------------------------ */
/* buildCtx                                                             */
/* ------------------------------------------------------------------ */

/** True when the caller is a real user (act as the user) vs the app itself. */
function isUserAccount(accountId: string): boolean {
  return accountId !== SYSTEM_ACCOUNT_ID;
}

/**
 * Assemble the Ctx of one invocation. Injectable everywhere it matters
 * (stores, jira, now, randomness) so services stay testable without Forge.
 */
export async function buildCtx(options: BuildCtxOptions = {}): Promise<Ctx> {
  const stores = options.stores ?? (await forgeStores());
  const identity = identityFrom(options);
  const projectId = projectIdFor(options);
  const ctx: Ctx = {
    stores,
    now: options.now ?? realNow,
    identity,
    projectId,
    randomHex: options.randomHex ?? cryptoRandomHex,
    sha256: options.sha256 ?? cryptoSha256,
  };
  // Injected stores (tests, simulation) never reach Jira unless a port is given.
  const jira =
    options.jira ??
    (options.stores === undefined
      ? makeJiraPort({
          stores,
          projectId,
          accountId: isUserAccount(identity.accountId) ? identity.accountId : undefined,
        })
      : undefined);
  if (jira !== undefined) ctx.jira = jira;
  return ctx;
}
