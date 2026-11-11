/**
 * storage/forge/notices — NoticeStore over Forge SQL.
 * Owner: workstream E.
 *
 * Semantics (src/storage/interfaces.ts + memory stub docstrings):
 *  - recipients are registered at post time (one notice_recipient row each);
 *  - `pendingFor` returns the UNDELIVERED notices of the given worksites,
 *    oldest first;
 *  - `markDelivered` is idempotent: a notice is delivered ONCE per worksite;
 *  - `listByWorksite` lists the notices AUTHORED by that worksite.
 *
 * No JOIN is used: the pending-notice view is assembled from four bounded
 * queries (recipients → notices → author worksites → sessions), which keeps
 * the SQL inside what Forge SQL is documented to accept.
 */

import { dictFor, format } from "../../i18n/format";
import type { ActorKind, Notice, NoticeView } from "../../core/types";
import type { NoticeStore } from "../interfaces";
import { all, json, newId, parseJson, run, str, upsert } from "./db";

/** Labels are rendered in the submission language; the UI re-renders if needed. */
const LABEL_LOCALE = "en";

interface NoticeRow {
  id: string;
  worksite_id: string;
  repo_id: string;
  author_account_id: string;
  issue_key: string;
  paths: string;
  text: string;
  created_at: string;
}

interface RecipientRow {
  notice_id: string;
  worksite_id: string;
}

function toNotice(row: NoticeRow): Notice {
  return {
    id: str(row.id),
    worksiteId: str(row.worksite_id),
    repoId: str(row.repo_id),
    authorAccountId: str(row.author_account_id),
    issueKey: str(row.issue_key),
    paths: parseJson<string[]>(row.paths, []),
    text: str(row.text),
    createdAt: str(row.created_at),
  };
}

/** Same wording as core/verdict.neighborLabel, straight from the dictionary. */
export function actorLabel(
  accountId: string,
  kind: ActorKind,
  sessionRef?: string,
): string {
  if (kind !== "agent") return accountId;
  const session = sessionRef ? sessionRef.slice(0, 4) : "-";
  return format(dictFor(LABEL_LOCALE), "tag.agentOf", { name: accountId, session });
}

interface AuthorInfo {
  accountId: string;
  kind: ActorKind;
  sessionRef?: string;
}

/** Author labels of a set of worksites, in one pass over worksite + session. */
async function authorsOf(worksiteIds: string[]): Promise<Record<string, AuthorInfo>> {
  const found: Record<string, AuthorInfo> = {};
  if (worksiteIds.length === 0) return found;
  const worksites = await all<{
    id: string;
    account_id: string;
    kind: string;
    session_id: string;
  }>`SELECT id, account_id, kind, session_id FROM worksite WHERE id IN (${worksiteIds})`;
  const sessionIds = worksites.map((row) => str(row.session_id)).filter((id) => id !== "");
  const sessions =
    sessionIds.length === 0
      ? []
      : await all<{ id: string; session_ref: string }>`
          SELECT id, session_ref FROM actor_session WHERE id IN (${sessionIds})`;
  const refs = new Map(sessions.map((row) => [str(row.id), str(row.session_ref)]));
  worksites.forEach((row) => {
    const sessionId = str(row.session_id);
    const info: AuthorInfo = {
      accountId: str(row.account_id),
      kind: str(row.kind) as ActorKind,
    };
    const sessionRef = refs.get(sessionId);
    if (sessionRef) info.sessionRef = sessionRef;
    found[str(row.id)] = info;
  });
  return found;
}

/** Insert the recipient rows that do not exist yet. */
async function registerRecipients(noticeId: string, worksiteIds: string[]): Promise<void> {
  if (worksiteIds.length === 0) return;
  const existing = await all<RecipientRow>`
    SELECT notice_id, worksite_id FROM notice_recipient
    WHERE notice_id = ${noticeId} AND worksite_id IN (${worksiteIds})`;
  const known = new Set(existing.map((row) => str(row.worksite_id)));
  for (const worksiteId of worksiteIds) {
    if (known.has(worksiteId)) continue;
    await upsert(
      "notice_recipient",
      newId("rcp"),
      ["notice_id", "worksite_id", "delivered_at"],
      [noticeId, worksiteId, ""],
    );
  }
}

export function createNoticeStore(): NoticeStore {
  return {
    async post(
      notice: Omit<Notice, "id"> & { id?: string },
      recipientWorksiteIds: string[],
    ): Promise<Notice> {
      const stored: Notice = { ...notice, id: notice.id ?? newId("ntc") };
      await upsert(
        "notice",
        stored.id,
        ["worksite_id", "repo_id", "author_account_id", "issue_key", "paths", "text", "created_at"],
        [
          stored.worksiteId,
          stored.repoId,
          stored.authorAccountId,
          stored.issueKey,
          json(stored.paths),
          stored.text,
          stored.createdAt,
        ],
      );
      await registerRecipients(stored.id, recipientWorksiteIds);
      return stored;
    },

    async listByWorksite(worksiteId: string): Promise<Notice[]> {
      const rows = await all<NoticeRow>`
        SELECT * FROM notice WHERE worksite_id = ${worksiteId} ORDER BY created_at ASC`;
      return rows.map(toNotice);
    },

    async pendingFor(worksiteIds: string[]): Promise<NoticeView[]> {
      if (worksiteIds.length === 0) return [];
      const recipients = await all<RecipientRow>`
        SELECT notice_id, worksite_id FROM notice_recipient
        WHERE worksite_id IN (${worksiteIds}) AND delivered_at = ''`;
      const noticeIds = Array.from(new Set(recipients.map((row) => str(row.notice_id))));
      if (noticeIds.length === 0) return [];
      const notices = await all<NoticeRow>`
        SELECT * FROM notice WHERE id IN (${noticeIds}) ORDER BY created_at ASC`;
      const authors = await authorsOf(notices.map((row) => str(row.worksite_id)));
      return notices.map((row) => {
        const notice = toNotice(row);
        const author = authors[notice.worksiteId];
        return {
          noticeId: notice.id,
          fromIssueKey: notice.issueKey,
          fromActorLabel: actorLabel(
            notice.authorAccountId,
            author?.kind ?? "human",
            author?.sessionRef,
          ),
          paths: notice.paths,
          text: notice.text,
          createdAt: notice.createdAt,
        };
      });
    },

    async markDelivered(noticeId: string, worksiteId: string, at: string): Promise<void> {
      await run`
        UPDATE notice_recipient SET delivered_at = ${at}
        WHERE notice_id = ${noticeId} AND worksite_id = ${worksiteId} AND delivered_at = ''`;
    },
  };
}