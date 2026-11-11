/**
 * storage/memory/sessions — SessionStore.
 *
 * `touch` is an upsert on (accountId, client, sessionRef, agentRef): it
 * refreshes lastSeen, keeps firstSeen and the id of the session.
 */

import type { ActorSession } from "../../core/types";
import type { SessionStore } from "../interfaces";
import { clone } from "./clone";
import type { IdGen } from "./ids";
import type { MemoryData } from "./state";

type TouchInput = Parameters<SessionStore["touch"]>[0];

function sessionKey(s: {
  accountId: string;
  client: string;
  sessionRef?: string;
  agentRef?: string;
}): string {
  return [s.accountId, s.client, s.sessionRef ?? "", s.agentRef ?? ""].join("\u0000");
}

/** The mutable part of a session; id/firstSeen/lastSeen are store-owned. */
function fieldsOf(session: TouchInput): Omit<ActorSession, "id" | "firstSeen" | "lastSeen"> {
  return {
    accountId: session.accountId,
    kind: session.kind,
    client: session.client,
    sessionRef: session.sessionRef,
    agentRef: session.agentRef,
    parentSessionId: session.parentSessionId,
  };
}

export function createSessionStore(data: MemoryData, ids: IdGen): SessionStore {
  const findSame = (input: TouchInput): ActorSession | undefined => {
    const byId = input.id ? data.sessions.get(input.id) : undefined;
    if (byId) return byId;
    const key = sessionKey(input);
    for (const session of data.sessions.values()) {
      if (sessionKey(session) === key) return session;
    }
    return undefined;
  };

  return {
    async touch(session: TouchInput): Promise<ActorSession> {
      const known = findSame(session);
      const id = known ? known.id : session.id || ids("ses");
      const stored: ActorSession = {
        ...clone(fieldsOf(session)),
        id,
        firstSeen: known ? known.firstSeen : session.at,
        lastSeen: session.at,
      };
      data.sessions.set(id, stored);
      return clone(stored);
    },

    async findById(id: string): Promise<ActorSession | undefined> {
      const session = data.sessions.get(id);
      return session ? clone(session) : undefined;
    },

    async findByRef(
      accountId: string,
      sessionRef: string,
      agentRef?: string,
    ): Promise<ActorSession | undefined> {
      let best: ActorSession | undefined;
      for (const session of data.sessions.values()) {
        if (session.accountId !== accountId || session.sessionRef !== sessionRef) continue;
        if (agentRef !== undefined && session.agentRef !== agentRef) continue;
        if (!best || session.lastSeen > best.lastSeen) best = session;
      }
      return best ? clone(best) : undefined;
    },

    async listByAccount(accountId: string): Promise<ActorSession[]> {
      const out: ActorSession[] = [];
      for (const session of data.sessions.values()) {
        if (session.accountId === accountId) out.push(clone(session));
      }
      return out.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
    },
  };
}
