/**
 * tests/core/footprints.test.ts — footprint building, merging and coverage
 * (workstream D). Covers spec §5: paths parsing (comments, blanks, dedup),
 * the source hierarchy (the fact beats the intent), the mode hierarchy, the
 * declared/observed gap, and the rendering of the worksite mailbox (§9.4).
 */

import { describe, expect, it } from "vitest";
import {
  coverageOf,
  entriesFromPaths,
  mergeEntries,
} from "../../src/core/footprints";
import { renderNoticesForAgent } from "../../src/core/notices";
import { classifyPath } from "../../src/core/paths";
import type {
  FootprintEntry,
  FootprintEntryInput,
  FootprintMode,
  FootprintSource,
  NoticeView,
} from "../../src/core/types";
import { plusMinutes } from "../../src/testing/clock";

const T0 = "2026-11-11T09:00:00.000Z";
const WS = "ws-1";

function input(
  path: string,
  source: FootprintSource,
  mode: FootprintMode = "edit",
  worksiteId = WS,
): FootprintEntryInput {
  return { worksiteId, path, kind: classifyPath(path), source, mode };
}

function stored(
  path: string,
  source: FootprintSource,
  mode: FootprintMode = "edit",
  at = T0,
): FootprintEntry {
  return { ...input(path, source, mode), firstAt: at, lastAt: at };
}

function notice(over: Partial<NoticeView> = {}): NoticeView {
  return {
    noticeId: "n-1",
    fromIssueKey: "PROJ-88",
    fromActorLabel: "agent of Léa",
    paths: ["src/billing/**"],
    text: "renaming invoices.total to total_cents",
    createdAt: T0,
    ...over,
  };
}

describe("entriesFromPaths", () => {
  it("ignores comments, blank lines and duplicates", () => {
    const block = [
      "# declaration du chantier",
      "src/billing/invoice.ts",
      "",
      "   ",
      "  src/billing/total.ts  ",
      "src/billing/invoice.ts",
      "# fin",
    ].join("\n");
    const entries = entriesFromPaths(block, WS, "declared", "edit", T0);
    expect(entries.map((entry) => entry.path)).toEqual([
      "src/billing/invoice.ts",
      "src/billing/total.ts",
    ]);
  });

  it("normalizes paths and classifies files, dirs and patterns", () => {
    const entries = entriesFromPaths(
      "./src/billing/invoice.ts\n/src/auth/\ndb/migrations/**",
      WS,
      "declared",
      "create",
      T0,
    );
    expect(entries).toEqual([
      {
        worksiteId: WS,
        path: "src/billing/invoice.ts",
        kind: "file",
        source: "declared",
        mode: "create",
        at: T0,
      },
      { worksiteId: WS, path: "src/auth", kind: "dir", source: "declared", mode: "create", at: T0 },
      {
        worksiteId: WS,
        path: "db/migrations/**",
        kind: "pattern",
        source: "declared",
        mode: "create",
        at: T0,
      },
    ]);
  });

  it("returns nothing for an empty block", () => {
    expect(entriesFromPaths("\n\n# rien\n", WS, "declared", "edit", T0)).toEqual([]);
  });
});

describe("mergeEntries — source hierarchy", () => {
  it("creates unknown paths with firstAt = lastAt = at", () => {
    const at = plusMinutes(T0, 10);
    const result = mergeEntries([], [input("src/a.ts", "declared")], at);
    expect(result.mismatches).toEqual([]);
    expect(result.toAdd).toHaveLength(1);
    expect(result.toAdd[0]).toMatchObject({
      path: "src/a.ts",
      source: "declared",
      at,
      firstAt: at,
      lastAt: at,
    });
    expect(result.toAdd[0].declaredMismatch).toBeUndefined();
  });

  it("keeps firstAt and refreshes lastAt when the same path comes back", () => {
    const at = plusMinutes(T0, 30);
    const result = mergeEntries([stored("src/a.ts", "declared")], [input("src/a.ts", "declared")], at);
    expect(result.toAdd[0].firstAt).toBe(T0);
    expect(result.toAdd[0].lastAt).toBe(at);
  });

  it("upgrades declared to observed to attested, never downgrades", () => {
    const at = plusMinutes(T0, 30);
    const up = mergeEntries([stored("src/a.ts", "declared")], [input("src/a.ts", "observed")], at);
    expect(up.toAdd[0].source).toBe("observed");
    const top = mergeEntries([stored("src/a.ts", "observed")], [input("src/a.ts", "attested")], at);
    expect(top.toAdd[0].source).toBe("attested");
    const down = mergeEntries([stored("src/a.ts", "attested")], [input("src/a.ts", "predicted")], at);
    expect(down.toAdd[0].source).toBe("attested");
  });

  it("keeps the most destructive mode (edit < create < delete/rename)", () => {
    const at = plusMinutes(T0, 5);
    const del = mergeEntries([stored("src/a.ts", "declared", "edit")], [input("src/a.ts", "declared", "delete")], at);
    expect(del.toAdd[0].mode).toBe("delete");
    const keepRename = mergeEntries([stored("src/a.ts", "declared", "rename")], [input("src/a.ts", "declared", "delete")], at);
    expect(keepRename.toAdd[0].mode).toBe("rename");
    const create = mergeEntries([stored("src/a.ts", "declared", "create")], [input("src/a.ts", "declared", "edit")], at);
    expect(create.toAdd[0].mode).toBe("create");
  });

  it("merges a duplicated incoming path, keeping the last and the strongest", () => {
    const at = plusMinutes(T0, 5);
    const result = mergeEntries(
      [],
      [input("src/a.ts", "declared", "edit"), input("src/a.ts", "observed", "create")],
      at,
    );
    expect(result.toAdd).toHaveLength(1);
    expect(result.toAdd[0]).toMatchObject({ source: "observed", mode: "create" });
  });
});

describe("mergeEntries — declared / observed gap", () => {
  it("flags an observed path outside the declaration", () => {
    const at = plusMinutes(T0, 20);
    const result = mergeEntries(
      [stored("src/a.ts", "declared")],
      [input("src/b.ts", "observed")],
      at,
    );
    expect(result.mismatches).toEqual(["src/b.ts"]);
    expect(result.toAdd[0].declaredMismatch).toBe(true);
  });

  it("does not flag an observed path covered by a declared dir", () => {
    const result = mergeEntries(
      [stored("src/billing", "declared")],
      [input("src/billing/invoice.ts", "observed")],
      plusMinutes(T0, 20),
    );
    expect(result.mismatches).toEqual([]);
    expect(result.toAdd[0].declaredMismatch).toBeUndefined();
  });

  it("does not flag an attested path on the declared file, nor predicted ones", () => {
    const same = mergeEntries(
      [stored("src/a.ts", "declared")],
      [input("src/a.ts", "attested")],
      plusMinutes(T0, 20),
    );
    expect(same.mismatches).toEqual([]);
    const predicted = mergeEntries(
      [stored("src/a.ts", "declared")],
      [input("src/z.ts", "predicted")],
      plusMinutes(T0, 20),
    );
    expect(predicted.mismatches).toEqual([]);
    expect(predicted.toAdd[0].declaredMismatch).toBeUndefined();
  });

  it("lists each mismatching path once and keeps an earlier mismatch flag", () => {
    const at = plusMinutes(T0, 40);
    const result = mergeEntries(
      [{ ...stored("src/b.ts", "observed"), declaredMismatch: true }],
      [input("src/b.ts", "observed"), input("src/b.ts", "attested")],
      at,
    );
    expect(result.mismatches).toEqual(["src/b.ts"]);
    expect(result.toAdd[0].declaredMismatch).toBe(true);
  });
});

describe("coverageOf", () => {
  it("counts entries per source", () => {
    const coverage = coverageOf([
      stored("src/a.ts", "predicted"),
      stored("src/b.ts", "declared"),
      stored("src/c.ts", "declared"),
      stored("src/d.ts", "observed"),
    ]);
    expect(coverage).toEqual({ predicted: 1, declared: 2, observed: 1 });
    expect(coverageOf([])).toEqual({});
  });
});

describe("renderNoticesForAgent", () => {
  it("renders one line per notice with sender, words and paths", () => {
    const text = renderNoticesForAgent([notice()], "en");
    expect(text).toBe(
      '[PROJ-88 · agent of Léa] "renaming invoices.total to total_cents" (src/billing/**)',
    );
  });

  it("joins several paths with a comma and keeps notice order", () => {
    const text = renderNoticesForAgent(
      [
        notice(),
        notice({
          noticeId: "n-2",
          fromIssueKey: "PROJ-91",
          fromActorLabel: "Marc",
          text: "auth/ is frozen until 15:00",
          paths: ["src/auth/login.ts", "src/auth/session.ts"],
        }),
      ],
      "fr",
    );
    expect(text.split("\n")).toHaveLength(2);
    expect(text.split("\n")[1]).toBe(
      '[PROJ-91 · Marc] "auth/ is frozen until 15:00" (src/auth/login.ts, src/auth/session.ts)',
    );
  });

  it("returns an empty string when there is nothing", () => {
    expect(renderNoticesForAgent([], "fr")).toBe("");
  });
});
