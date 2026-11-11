/**
 * tests/core/predict.test.ts — predicted footprints (workstream D, spec §5
 * "Prédite" and §13). Covers: component match, dir rollup, summary similarity,
 * announced confidence halved without a component, empty history, filtering.
 */

import { describe, expect, it } from "vitest";
import { predictFromHistory, summaryTokens } from "../../src/core/predict";
import type { MergedTicketHistory, TicketMeta } from "../../src/core/types";

function issue(over: Partial<TicketMeta> = {}): TicketMeta {
  return { issueKey: "BILL-10", components: ["billing"], ...over };
}

function merged(
  issueKey: string,
  paths: string[],
  over: Partial<MergedTicketHistory> = {},
): MergedTicketHistory {
  return { issueKey, components: ["billing"], paths, ...over };
}

describe("summaryTokens", () => {
  it("lowercases, strips punctuation and drops short words", () => {
    expect(summaryTokens("Fix the invoices.total field, and rounding!")).toEqual([
      "fix",
      "invoices",
      "total",
      "field",
      "rounding",
    ]);
  });

  it("drops basic English stopwords and handles an empty summary", () => {
    expect(summaryTokens("the and for with from that this are was will")).toEqual([]);
    expect(summaryTokens("wait for the invoices")).toEqual(["wait", "invoices"]);
    expect(summaryTokens("")).toEqual([]);
  });
});

describe("predictFromHistory — component match", () => {
  it("predicts the rolled-up dir of the component's tickets", () => {
    const history = [
      merged("BILL-1", ["src/billing/invoice.ts"]),
      merged("BILL-2", ["src/billing/total.ts"]),
    ];
    const result = predictFromHistory(issue(), history);
    expect(result.componentMatch).toBe(true);
    expect(result.entries).toEqual([{ path: "src/billing", kind: "dir", confidence: 1 }]);
    expect(result.confidence).toBe(1);
    expect(result.referenceTickets).toEqual(["BILL-1", "BILL-2"]);
  });

  it("rolls up only dirs present in at least 60 % of the component tickets", () => {
    const history = [
      merged("BILL-1", ["src/billing/a.ts"]),
      merged("BILL-2", ["src/billing/b.ts"]),
      merged("BILL-3", ["src/billing/c.ts"]),
      merged("BILL-4", ["src/auth/login.ts"]),
      merged("BILL-5", ["src/auth/login.ts"]),
    ];
    const result = predictFromHistory(issue(), history);
    expect(result.entries).toEqual([
      { path: "src/billing", kind: "dir", confidence: 0.6 },
      { path: "src/auth/login.ts", kind: "file", confidence: 0.4 },
    ]);
    expect(result.confidence).toBe(0.5);
  });

  it("ignores tickets without a shared component and keeps the file kind", () => {
    const history = [
      merged("OPS-1", ["db/migrations/0042.sql"], { components: ["ops"] }),
      merged("BILL-7", ["src/billing/invoice.ts"]),
    ];
    const result = predictFromHistory(issue(), history);
    expect(result.entries).toEqual([
      { path: "src/billing", kind: "dir", confidence: 1 },
    ]);
    expect(result.referenceTickets).toEqual(["BILL-7"]);
  });
});

describe("predictFromHistory — summary similarity", () => {
  it("uses similar summaries at half weight and halves the confidence", () => {
    const history = [
      merged("OTH-1", ["src/billing/invoice.ts"], {
        components: ["reporting"],
        summary: "Refactor invoices total computation",
      }),
    ];
    const result = predictFromHistory(
      issue({ components: ["billing"], summary: "Refactor invoices total computation" }),
      history,
    );
    expect(result.componentMatch).toBe(false);
    expect(result.entries).toEqual([
      { path: "src/billing/invoice.ts", kind: "file", confidence: 0.5 },
    ]);
    expect(result.confidence).toBe(0.25);
    expect(result.referenceTickets).toEqual(["OTH-1"]);
  });

  it("skips unrelated tickets entirely", () => {
    const result = predictFromHistory(
      issue({ components: ["billing"], summary: "Fix invoice rounding" }),
      [merged("OTH-1", ["src/auth/login.ts"], { components: ["auth"], summary: "Login page" })],
    );
    expect(result).toEqual({
      entries: [],
      confidence: 0,
      referenceTickets: [],
      componentMatch: false,
    });
  });
});

describe("predictFromHistory — edges", () => {
  it("returns an empty prediction for an empty history", () => {
    expect(predictFromHistory(issue(), [])).toEqual({
      entries: [],
      confidence: 0,
      referenceTickets: [],
      componentMatch: false,
    });
  });

  it("filters below minConfidence and caps at maxEntries", () => {
    const history = [
      merged("BILL-1", ["src/billing/a.ts"]),
      merged("BILL-2", ["src/billing/b.ts"]),
      merged("BILL-3", ["src/billing/c.ts"]),
      merged("BILL-4", ["src/auth/login.ts"]),
      merged("BILL-5", ["src/auth/login.ts"]),
    ];
    const filtered = predictFromHistory(issue(), history, { minConfidence: 0.5 });
    expect(filtered.entries.map((entry) => entry.path)).toEqual(["src/billing"]);
    const capped = predictFromHistory(issue(), history, { maxEntries: 1 });
    expect(capped.entries).toHaveLength(1);
    expect(capped.confidence).toBe(0.6);
  });

  it("references at most five merged tickets", () => {
    const history = Array.from({ length: 7 }, (_, index) =>
      merged(`BILL-${index + 1}`, [`src/billing/f${index}.ts`]),
    );
    const result = predictFromHistory(issue(), history);
    expect(result.referenceTickets).toHaveLength(5);
    expect(result.componentMatch).toBe(true);
  });
});
