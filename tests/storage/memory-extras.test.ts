// Reservations, notices, predictions, conflicts, tokens, events, rules (split 3/3).
import { describe, expect, it } from "vitest";
import { T0, at } from "./helpers";
import { DEFAULT_PRIORITY_RULES } from "../../src/core/types";
import type { PriorityRules } from "../../src/core/types";
import { createMemoryStores } from "../../src/storage/memory";

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

describe("ReservationStore", () => {
  it("listActive excludes the released and the expired reservations", async () => {
    const stores = createMemoryStores();
    const active = await stores.reservations.create({
      worksiteId: "ws-1",
      repoId: "repo-1",
      patterns: ["src/**"],
      hard: true,
      createdAt: T0,
      expiresAt: at(60),
    });
    await stores.reservations.create({
      worksiteId: "ws-2",
      repoId: "repo-1",
      patterns: ["lib/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(-10),
    });
    const released = await stores.reservations.create({
      worksiteId: "ws-3",
      repoId: "repo-1",
      patterns: ["docs/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
      releasedAt: at(5),
    });
    const list = await stores.reservations.listActive("repo-1", T0);
    expect(list.map((r) => r.id)).toEqual([active.id]);
    expect(released.id).toBeTruthy();
    expect(await stores.reservations.listByWorksite("ws-1", T0)).toHaveLength(1);
  });

  it("findActiveOverlapping matches the patterns and the plain paths", async () => {
    const stores = createMemoryStores();
    const glob = await stores.reservations.create({
      worksiteId: "ws-1",
      repoId: "repo-1",
      patterns: ["src/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
    });
    const dir = await stores.reservations.create({
      worksiteId: "ws-2",
      repoId: "repo-1",
      patterns: ["lib"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
    });
    await stores.reservations.create({
      worksiteId: "ws-3",
      repoId: "repo-1",
      patterns: ["docs/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
    });
    const hits = await stores.reservations.findActiveOverlapping("repo-1", ["src/app.ts"], T0);
    expect(hits.map((r) => r.id)).toEqual([glob.id]);
    const deep = await stores.reservations.findActiveOverlapping("repo-1", ["lib/deep/file.ts"], T0);
    expect(deep.map((r) => r.id)).toEqual([dir.id]);
    expect(await stores.reservations.findActiveOverlapping("repo-1", ["docs/readme.md"], T0)).toHaveLength(
      1,
    );
    expect(await stores.reservations.findActiveOverlapping("repo-2", ["src/app.ts"], T0)).toHaveLength(0);
  });

  it("release and releaseExpired free the reservations once", async () => {
    const stores = createMemoryStores();
    const r = await stores.reservations.create({
      worksiteId: "ws-1",
      repoId: "repo-1",
      patterns: ["src/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(60),
    });
    expect(await stores.reservations.release(r.id, at(10))).toBe(true);
    expect(await stores.reservations.release("res-unknown", at(10))).toBe(false);
    expect((await stores.reservations.findById(r.id))?.releasedAt).toBe(at(10));
    const expired = await stores.reservations.create({
      worksiteId: "ws-2",
      repoId: "repo-1",
      patterns: ["lib/**"],
      hard: false,
      createdAt: T0,
      expiresAt: at(-10),
    });
    const released = await stores.reservations.releaseExpired(T0);
    expect(released.map((x) => x.id)).toEqual([expired.id]);
    expect(await stores.reservations.releaseExpired(T0)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

describe("NoticeStore", () => {
  it("post registers the recipients and pendingFor returns the views oldest first", async () => {
    const stores = createMemoryStores();
    const notice = await stores.notices.post(
      {
        worksiteId: "ws-1",
        repoId: "repo-1",
        authorAccountId: "lea@example.com",
        issueKey: "PROJ-1",
        paths: ["src/app.ts"],
        text: "je prends src/app.ts",
        createdAt: T0,
      },
      ["ws-2"],
    );
    expect(notice.id).toMatch(/^ntc-\d+$/);
    const pending = await stores.notices.pendingFor(["ws-2"]);
    expect(pending).toHaveLength(1);
    expect(pending[0].fromIssueKey).toBe("PROJ-1");
    expect(pending[0].fromActorLabel).toBe("lea@example.com");
    expect(pending[0].paths).toEqual(["src/app.ts"]);
    expect(await stores.notices.pendingFor(["ws-3"])).toHaveLength(0);
    expect(await stores.notices.listByWorksite("ws-1")).toHaveLength(1);
  });

  it("markDelivered delivers a notice once per worksite", async () => {
    const stores = createMemoryStores();
    const notice = await stores.notices.post(
      {
        worksiteId: "ws-1",
        repoId: "repo-1",
        authorAccountId: "lea@example.com",
        issueKey: "PROJ-1",
        paths: [],
        text: "attention",
        createdAt: T0,
      },
      ["ws-2", "ws-3"],
    );
    await stores.notices.markDelivered(notice.id, "ws-2", at(5));
    await stores.notices.markDelivered(notice.id, "ws-2", at(9));
    expect((await stores.notices.pendingFor(["ws-2"])).map((n) => n.noticeId)).not.toContain(notice.id);
    expect((await stores.notices.pendingFor(["ws-3"])).map((n) => n.noticeId)).toContain(notice.id);
  });
});

/* ------------------------------------------------------------------ */
/* Predictions, conflicts, tokens, events, rules                       */
/* ------------------------------------------------------------------ */

describe("PredictionStore", () => {
  it("save replaces the predictions of the same issue and repo", async () => {
    const stores = createMemoryStores();
    const prediction = {
      issueKey: "PROJ-1",
      repoId: "repo-1",
      entries: [{ path: "src/app.ts", kind: "file" as const, confidence: 0.7 }],
      confidence: 0.7,
      basis: { componentMatch: true, referenceTickets: [] },
      computedAt: T0,
    };
    await stores.predictions.save(prediction);
    await stores.predictions.save({ ...prediction, confidence: 0.9, computedAt: at(10) });
    const found = await stores.predictions.findByIssue("PROJ-1", "repo-1");
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe(0.9);
    expect(await stores.predictions.findByIssue("PROJ-1", "repo-2")).toHaveLength(0);
    expect(await stores.predictions.removeByIssue("PROJ-1")).toBe(1);
    expect(await stores.predictions.findByIssue("PROJ-1")).toHaveLength(0);
  });
});

describe("ConflictStore", () => {
  it("reports and lists the real conflicts", async () => {
    const stores = createMemoryStores();
    const conflict = await stores.conflicts.report({
      repoId: "repo-1",
      worksiteA: "ws-1",
      worksiteB: "ws-2",
      issueKeyA: "PROJ-1",
      issueKeyB: "PROJ-2",
      paths: ["src/app.ts"],
      wasDetected: true,
      reportedAt: T0,
    });
    expect(conflict.id).toMatch(/^cfl-\d+$/);
    expect(await stores.conflicts.list("repo-1")).toHaveLength(1);
    expect(await stores.conflicts.list("repo-2")).toHaveLength(0);
    expect(await stores.conflicts.list("repo-1", at(10))).toHaveLength(0);
  });
});

describe("TokenStore", () => {
  it("creates, finds, touches and revokes the hook tokens", async () => {
    const stores = createMemoryStores();
    const token = await stores.tokens.create({
      accountId: "lea@example.com",
      tokenHash: "abc123",
      scope: "personal",
      createdAt: T0,
    });
    expect((await stores.tokens.findByHash("abc123"))?.accountId).toBe("lea@example.com");
    await stores.tokens.touchLastUsed("abc123", at(5));
    expect((await stores.tokens.findByHash("abc123"))?.lastUsedAt).toBe(at(5));
    expect(await stores.tokens.listByAccount("lea@example.com")).toHaveLength(1);
    expect(await stores.tokens.revoke("abc123")).toBe(true);
    expect(await stores.tokens.findByHash("abc123")).toBeUndefined();
    expect(token.scope).toBe("personal");
  });
});

describe("EventStore", () => {
  it("appends events with an increasing seq", async () => {
    const stores = createMemoryStores();
    const first = await stores.events.append({ at: T0, kind: "declare", worksiteId: "ws-1" });
    const second = await stores.events.append({ at: at(5), kind: "touch", worksiteId: "ws-2" });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect((await stores.events.listByWorksite("ws-1")).map((e) => e.seq)).toEqual([1]);
    expect((await stores.events.recent(1)).map((e) => e.seq)).toEqual([2]);
  });
});

describe("RulesStore", () => {
  it("falls back to the default rules and stores the ones of the project", async () => {
    const stores = createMemoryStores();
    const defaults = await stores.rules.get("PROJ");
    expect(defaults).toEqual({ ...DEFAULT_PRIORITY_RULES, projectId: "PROJ" });
    const rules: PriorityRules = { ...defaults, order: ["incident", "first"], hardMode: true };
    await stores.rules.set(rules);
    const stored = await stores.rules.get("PROJ");
    expect(stored.hardMode).toBe(true);
    expect(stored.order).toEqual(["incident", "first"]);
    expect((await stores.rules.get("OTHER")).hardMode).toBe(false);
  });
});
