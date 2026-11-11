/**
 * Service context — everything a service function may depend on.
 * Services are pure orchestrators: no @forge/* import in src/services/.
 */

import type { Identity, TicketMeta } from "../core/types";
import type { Stores } from "../storage/interfaces";

/** Jira-side effects, injected by the resolver glue (src/forge-context.ts).
 *  Absent in tests and in the simulation console — services must cope.
 *  EVERY method is optional: a partial port (tests, degraded mode) must
 *  never crash a service; guard each call (`ctx.jira?.method?.(…)`). */
export interface JiraPort {
  /** Run a JQL search; returns ticket metadata. */
  searchIssues?(jql: string): Promise<TicketMeta[]>;
  getIssue?(issueKey: string): Promise<TicketMeta | undefined>;
  /** Update the "Collisions" custom field (best effort). */
  setCollisionsField?(issueKey: string, value: string): Promise<void>;
  /** Create an "is blocked by" link (sequencing). */
  createIssueLink?(blockedIssueKey: string, blockerIssueKey: string): Promise<void>;
  /** Comment on a ticket (notices for humans, plan publication). */
  commentOnIssue?(issueKey: string, body: string): Promise<void>;
  /** Merged tickets used as prediction history for a repo's project. */
  mergedHistory?(repoSlug: string): Promise<import("../core/types").MergedTicketHistory[]>;
}

export interface Ctx {
  stores: Stores;
  /** Injectable clock — always use ctx.now(), never Date.now() in services. */
  now(): string;
  /** The caller, from auth context or token. NEVER from tool inputs. */
  identity: Identity;
  /** Jira project key of the calling context. */
  projectId: string;
  jira?: JiraPort;
  /** Injectable randomness (tokens). Default: crypto in forge-context. */
  randomHex?(bytes: number): string;
  /** Injectable sha256 (defaults to node:crypto in forge-context). */
  sha256?(value: string): string;
}
