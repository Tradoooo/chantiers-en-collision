import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { dictFor, format, t } from "../src/i18n/format";
import { DEFAULT_PRIORITY_RULES, MAX_RESERVATION_MINUTES } from "../src/core/types";

describe("i18n", () => {
  it("formats placeholders", () => {
    expect(format(dictFor("en"), "tag.activeAgo", { mins: 4 })).toBe("active 4 min ago");
    expect(t("fr", "verdict.wait")).toBe("attendre");
  });

  it("en and fr dictionaries have the same keys", () => {
    const en = Object.keys(dictFor("en")).sort();
    const fr = Object.keys(dictFor("fr")).sort();
    expect(fr).toEqual(en);
  });

  it("leaves unknown placeholders untouched", () => {
    expect(format(dictFor("en"), "tag.activeAgo", {})).toBe("active {mins} min ago");
  });
});

describe("constants", () => {
  it("reservations are bounded (nothing eternal)", () => {
    expect(MAX_RESERVATION_MINUTES).toBe(1440);
    expect(DEFAULT_PRIORITY_RULES.order[0]).toBe("reservation");
    expect(DEFAULT_PRIORITY_RULES.agentYields).toBe(true);
  });
});

describe("manifest", () => {
  it("passes scripts/check-manifest.mjs", () => {
    const out = execFileSync("node", ["scripts/check-manifest.mjs"], {
      encoding: "utf8",
    });
    expect(out).toContain("manifest.yml OK");
  });
});
