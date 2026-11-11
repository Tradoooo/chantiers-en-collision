/**
 * storage/forge/sessions — SessionStore over Forge SQL.
 * Owner: workstream E.
 *
 * Semantics (src/storage/interfaces.ts): `touch` upserts on
 * (accountId, client, sessionRef, agentRef?) and refreshes lastSeen while
 * keeping the original firstSeen. Optional strings are stored as '' and read
 * back as undefined.
 */

import type { ActorKind, ActorSession } from "../../core/types";
import type { SessionStore } from "../interfaces";
import { all, newId, one, optStr, str, upsert } from "./db";

interface SessionRow {
  id: string;
  account_id: string;
  kind: string;
  client: string;
  session_ref: string;
  agent_ref: string;
  parent_session_id: string;
  first_seen: string;
  last_seen: string;
}

/** Input of `touch`: the session fields plus the observation instant. */
export type TouchInput = Omit<ActorSession, "id" | "firstSeen" | "lastSeen"> & {
  at: string;
  id?: string;
};

function toSession(row: SessionRow): ActorSession {
  const session: ActorSession = {
    id: str(row.id),
    accountId: str(row.account_id),
    kind: str(row.kind) as ActorKind,
    client: str(row.client),
    firstSeen: str(row.first_seen),
    lastSeen: str(row.last_seen),
  };
  const sessionRef = optStr(row.session_ref);
  if (sessionRef) session.sessionRef = sessionRef;
  const agentRef = optStr(row.agent_ref);
  if (agentRef) session.agentRef = agentRef;
  const parentSessionId = optStr(row.parent_session_id);
  if (parentSessionId) session.parentSessionId = parentSessionId;
  return session;
}

async function findByKey(
  accountId: string,
  client: string,
  sessionRef?: string,
  agentRef?: string,
): Promise<ActorSession | undefined> {
  const row = await one<SessionRow>`
    SELECT * FROM actor_session
    WHERE account_id = ${accountId}
      AND client = ${client}
      AND session_ref = ${sessionRef ?? ""}
      AND agent_ref = ${agentRef ?? ""}`;
  return row ? toSession(row) : undefined;
}

async function writeSession(session: ActorSession): Promise<void> {
  await upsert(
    "actor_session",
    session.id,
    [
      "account_id",
      "kind",
      "client",
      "session_ref",
      "agent_ref",
      "parent_session_id",
      "first_seen",
      "last_seen",
    ],
    [
      session.accountId,
      session.kind,
      session.client,
      session.sessionRef ?? "",
      session.agentRef ?? "",
      session.parentSessionId ?? "",
      session.firstSeen,
      session.lastSeen,
    ],
  );
}

async function touchSession(session: TouchInput): Promise<ActorSession> {
  const existing = await findByKey(
    session.accountId,
    session.client,
    session.sessionRef,
    session.agentRef,
  );
  const base: ActorSession = existing
    ? { ...existing, client: session.client, kind: session.kind }
    : {
        id: session.id ?? newId("ses"),
        accountId: session.accountId,
        kind: session.kind,
        client: session.client,
        firstSeen: session.at,
        lastSeen: session.at,
      };
  if (session.sessionRef) base.sessionRef = session.sessionRef;
  if (session.agentRef) base.agentRef = session.agentRef;
  if (session.parentSessionId) base.parentSessionId = session.parentSessionId;
  base.lastSeen = session.at;
  await writeSession(base);
  return base;
}

async function findSessionById(id: string): Promise<ActorSession | undefined> {
  const row = await one<SessionRow>`SELECT * FROM actor_session WHERE id = ${id}`;
  return row ? toSession(row) : undefined;
}

async function findSessionByRef(
  accountId: string,
  sessionRef: string,
  agentRef?: string,
): Promise<ActorSession | undefined> {
  const row = await one<SessionRow>`
    SELECT * FROM actor_session
    WHERE account_id = ${accountId}
      AND session_ref = ${sessionRef}
      AND agent_ref = ${agentRef ?? ""}
    ORDER BY last_seen DESC`;
  return row ? toSession(row) : undefined;
}

async function listSessionsByAccount(accountId: string): Promise<ActorSession[]> {
  const rows = await all<SessionRow>`
    SELECT * FROM actor_session
    WHERE account_id = ${accountId}
    ORDER BY last_seen DESC`;
  return rows.map(toSession);
}

export function createSessionStore(): SessionStore {
  return {
    touch: touchSession,
    findById: findSessionById,
    findByRef: findSessionByRef,
    listByAccount: listSessionsByAccount,
  };
}
