import { describe, expect, it } from "vitest";
import { DEGREES, VERDICT_KINDS } from "../../src/core/constants";
import { EN } from "../../src/i18n/en";
import { FR } from "../../src/i18n/fr";

describe("core/constants — the narrative counts", () => {
  it("lists exactly the four verdicts, in order", () => {
    expect([...VERDICT_KINDS]).toEqual(["free", "caution", "wait", "stop"]);
  });

  it("gives every verdict a message in EN and FR", () => {
    for (const kind of VERDICT_KINDS) {
      const key = `verdict.${kind}` as const;
      expect(EN[key].length).toBeGreaterThan(0);
      expect(FR[key].length).toBeGreaterThan(0);
    }
  });

  it("lists the six degrees D0..D5", () => {
    expect([...DEGREES]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps EN and FR in lockstep — one key per message", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(FR).sort());
  });
});