/**
 * storage/memory/notices — NoticeStore ("courrier de chantier").
 *
 * A notice is stored once, with one delivery row per recipient worksite
 * registered at post time. `pendingFor` returns the undelivered ones as
 * NoticeView (oldest first); `markDelivered` is idempotent, so a notice is
 * delivered exactly ONCE per worksite (spec §17 step 6).
 */

import type { Notice, NoticeView } from "../../core/types";
import type { NoticeStore } from "../interfaces";
import { clone } from "./clone";
import type { IdGen } from "./ids";
import type { MemoryData, NoticeDelivery } from "./state";

function deliveryKey(noticeId: string, worksiteId: string): string {
  return `${noticeId}\u0000${worksiteId}`;
}

function viewOf(notice: Notice): NoticeView {
  return {
    noticeId: notice.id,
    fromIssueKey: notice.issueKey,
    fromActorLabel: notice.authorAccountId,
    paths: clone(notice.paths),
    text: notice.text,
    createdAt: notice.createdAt,
  };
}

async function postNotice(
  data: MemoryData,
  ids: IdGen,
  notice: Omit<Notice, "id"> & { id?: string },
  recipientWorksiteIds: string[],
): Promise<Notice> {
  const stored: Notice = { ...clone(notice), id: notice.id || ids("ntc") };
  data.notices.set(stored.id, stored);
  for (const worksiteId of recipientWorksiteIds) {
    const key = deliveryKey(stored.id, worksiteId);
    if (data.deliveries.has(key)) continue;
    const row: NoticeDelivery = { noticeId: stored.id, worksiteId, deliveredAt: undefined };
    data.deliveries.set(key, row);
  }
  return clone(stored);
}

async function listNoticesByWorksite(data: MemoryData, worksiteId: string): Promise<Notice[]> {
  const out: Notice[] = [];
  for (const notice of data.notices.values()) {
    if (notice.worksiteId === worksiteId) out.push(clone(notice));
  }
  return out.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

async function pendingNoticesFor(data: MemoryData, worksiteIds: string[]): Promise<NoticeView[]> {
  const wanted = new Set(worksiteIds);
  const seen = new Set<string>();
  const out: NoticeView[] = [];
  for (const row of data.deliveries.values()) {
    if (row.deliveredAt || !wanted.has(row.worksiteId) || seen.has(row.noticeId)) continue;
    const notice = data.notices.get(row.noticeId);
    if (!notice) continue;
    seen.add(row.noticeId);
    out.push(viewOf(notice));
  }
  return out.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.noticeId.localeCompare(b.noticeId),
  );
}

async function markNoticeDelivered(
  data: MemoryData,
  noticeId: string,
  worksiteId: string,
  at: string,
): Promise<void> {
  const key = deliveryKey(noticeId, worksiteId);
  const row = data.deliveries.get(key);
  if (!row || row.deliveredAt) return; // idempotent: first delivery wins
  data.deliveries.set(key, { ...row, deliveredAt: at });
}

export function createNoticeStore(data: MemoryData, ids: IdGen): NoticeStore {
  return {
    post: (notice, recipientWorksiteIds) =>
      postNotice(data, ids, notice, recipientWorksiteIds),
    listByWorksite: (worksiteId) => listNoticesByWorksite(data, worksiteId),
    pendingFor: (worksiteIds) => pendingNoticesFor(data, worksiteIds),
    markDelivered: (noticeId, worksiteId, at) =>
      markNoticeDelivered(data, noticeId, worksiteId, at),
  };
}
