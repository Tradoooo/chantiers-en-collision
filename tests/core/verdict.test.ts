import { describe, expect, it } from "vitest";
import {
  adviceForCollision,
  formatVerdictText,
  neighborLabel,
  reasonForCollision,
  verdictKindFor,
} from "../../src/core/verdict";
import type { NeighborInfo, VerdictCollisionInfo } from "../../src/core/types";

const NOW = "2026-11-11T12:00:00.000Z";

function neighbor(over: Partial<NeighborInfo> = {}): NeighborInfo {
  return {
    worksiteId: "ws-2",
    issueKey: "PROJ-88",
    accountId: "lea@example.com",
    actorLabel: "agent of lea@example.com (session 3f2a)",
    kind: "agent",
    sessionRef: "3f2a",
    state: "review",
    lastActivityAt: "2026-11-11T11:56:00.000Z",
    prOpen: true,
    ...over,
  };
}

function collision(over: Partial<VerdictCollisionInfo> = {}): VerdictCollisionInfo {
  return {
    collisionId: "c1",
    degree: 4,
    zoneName: "migrations",
    zoneNature: "exclusive",
    path: "db/migrations/0042.sql",
    neighbor: neighbor(),
    reason: 'one worksite at a time in exclusive zone "migrations"',
    advice: "wait for PROJ-88 to merge, then continue",
    estimatedResumeMinutes: 25,
    ...over,
  };
}

describe("verdictKindFor", () => {
  it("maps degrees to kinds", () => {
    expect(verdictKindFor([], false)).toBe("free");
    expect(verdictKindFor([collision({ degree: 0 })], false)).toBe("free");
    expect(verdictKindFor([collision({ degree: 1 })], false)).toBe("caution");
    expect(verdictKindFor([collision({ degree: 2 })], false)).toBe("caution");
    expect(verdictKindFor([collision({ degree: 3 })], false)).toBe("wait");
    expect(verdictKindFor([collision({ degree: 4 })], false)).toBe("wait");
    expect(verdictKindFor([collision({ degree: 4 })], true)).toBe("stop");
    expect(verdictKindFor([collision({ degree: 5 })], false)).toBe("caution");
  });

  it("takes the worst collision", () => {
    expect(
      verdictKindFor([collision({ degree: 1 }), collision({ degree: 4, collisionId: "c2" })], false),
    ).toBe("wait");
  });
});

describe("neighborLabel", () => {
  it("labels agents with their pilot and session", () => {
    expect(neighborLabel(neighbor(), "en")).toBe(
      "agent of lea@example.com (session 3f2a)",
    );
    expect(neighborLabel(neighbor(), "fr")).toBe(
      "agent de lea@example.com (session 3f2a)",
    );
  });

  it("labels humans with their account", () => {
    expect(neighborLabel(neighbor({ kind: "human" }), "en")).toBe("lea@example.com");
  });
});

describe("reasonForCollision", () => {
  it("words D4 by cause", () => {
    expect(
      reasonForCollision({ degree: 4, zoneNature: "exclusive", zoneName: "migrations", locale: "en" }),
    ).toBe('one worksite at a time in exclusive zone "migrations"');
    expect(
      reasonForCollision({
        degree: 4,
        zoneNature: "exclusive",
        zoneName: "migrations",
        until: "2026-11-11T15:10:00.000Z",
        reservedByIssueKey: "PROJ-88",
        locale: "en",
      }),
    ).toBe('"migrations" is reserved by PROJ-88 until 2026-11-11 15:10');
    expect(
      reasonForCollision({
        degree: 4,
        zoneNature: "frozen",
        zoneName: "billing",
        until: "2026-11-26T23:59:59.000Z",
        locale: "fr",
      }),
    ).toContain("gelée");
  });

  it("words file and dir collisions", () => {
    expect(reasonForCollision({ degree: 3, zoneNature: "ordinary", locale: "en" })).toBe(
      "one worksite deletes, moves or renames this file",
    );
    expect(reasonForCollision({ degree: 2, zoneNature: "ordinary", locale: "en" })).toBe(
      "same file touched by two worksites",
    );
    expect(reasonForCollision({ degree: 1, zoneNature: "ordinary", locale: "en" })).toBe(
      "same directory",
    );
    expect(
      reasonForCollision({ degree: 0, zoneNature: "ordinary", zoneName: "billing", locale: "en" }),
    ).toBe('same zone "billing", different files');
  });
});

describe("adviceForCollision", () => {
  it("advises waiting for an open PR", () => {
    expect(
      adviceForCollision({
        degree: 4,
        zoneNature: "exclusive",
        zoneName: "migrations",
        neighborIssueKey: "PROJ-88",
        neighborPrOpen: true,
        hardMode: false,
        locale: "en",
      }),
    ).toBe("wait for PROJ-88 to merge, then continue");
  });

  it("advises working outside without a PR", () => {
    expect(
      adviceForCollision({
        degree: 4,
        zoneNature: "exclusive",
        zoneName: "migrations",
        neighborIssueKey: "PROJ-88",
        hardMode: false,
        locale: "en",
      }),
    ).toBe("keep working outside migrations, then redeclare");
  });

  it("hard mode denies with the reason", () => {
    const advice = adviceForCollision({
      degree: 4,
      zoneNature: "exclusive",
      zoneName: "migrations",
      neighborIssueKey: "PROJ-88",
      hardMode: true,
      locale: "en",
    });
    expect(advice).toContain("edit denied by hard mode");
    expect(advice).toContain("exclusive zone");
  });

  it("D2 advises reading the neighbour", () => {
    expect(
      adviceForCollision({
        degree: 2,
        zoneNature: "ordinary",
        neighborIssueKey: "PROJ-88",
        hardMode: false,
        locale: "en",
      }),
    ).toBe("read the neighbor worksite before editing this file");
  });
});

describe("formatVerdictText", () => {
  it("formats the spec §8 block in English", () => {
    const text = formatVerdictText(
      { kind: "wait", collisions: [collision()], notices: [] },
      "en",
      NOW,
    );
    expect(text).toContain("verdict : wait");
    expect(text).toContain('collision : D4 · db/migrations/0042.sql · exclusive zone "migrations"');
    expect(text).toContain(
      "neighbor : PROJ-88 · agent of lea@example.com (session 3f2a) · PR open · active 4 min ago",
    );
    expect(text).toContain("reason : one worksite at a time");
    expect(text).toContain("what to do : wait for PROJ-88 to merge");
    expect(text).toContain("estimated resume : 25 min");
  });

  it("formats in French with guillemets", () => {
    const c = collision({
      neighbor: neighbor({ actorLabel: "agent de lea@example.com (session 3f2a)" }),
    });
    const text = formatVerdictText({ kind: "wait", collisions: [c], notices: [] }, "fr", NOW);
    expect(text).toContain("verdict : attendre");
    expect(text).toContain("collision : D4 · db/migrations/0042.sql · zone exclusive « migrations »");
    expect(text).toContain("voisin : PROJ-88");
    expect(text).toContain("reprise estimée : 25 min");
  });

  it("includes the neighbour notice and pending notices", () => {
    const text = formatVerdictText(
      {
        kind: "caution",
        collisions: [collision({ degree: 2, neighbor: neighbor({ notice: "renaming total to total_cents", prOpen: false, state: "active" }) })],
        notices: [{ fromIssueKey: "PROJ-90", text: "stay out of auth/ until 15:00" }],
      },
      "en",
      NOW,
    );
    expect(text).toContain(
      'neighbor\'s notice : "renaming total to total_cents"',
    );
    expect(text).toContain('[PROJ-90] "stay out of auth/ until 15:00"');
  });

  it("caps at three collision blocks, worst first", () => {
    const cs = [
      collision({ collisionId: "c1", degree: 1 }),
      collision({ collisionId: "c2", degree: 4 }),
      collision({ collisionId: "c3", degree: 2 }),
      collision({ collisionId: "c4", degree: 3 }),
    ];
    const text = formatVerdictText({ kind: "stop", collisions: cs, notices: [] }, "en", NOW);
    const blocks = text.split("---");
    expect(blocks.length).toBe(3);
    expect(text.indexOf("D4")).toBeLessThan(text.indexOf("D3"));
    expect(text).not.toContain("collision : D1 ");
  });

  it("free verdict has no collision block", () => {
    const text = formatVerdictText({ kind: "free", collisions: [], notices: [] }, "en", NOW);
    expect(text.trim()).toBe("verdict : free");
  });

  it("shows same-pilot and probable tags", () => {
    const text = formatVerdictText(
      {
        kind: "caution",
        collisions: [collision({ degree: 1, samePilot: true, probable: true, zoneName: undefined, zoneNature: "ordinary" })],
        notices: [],
      },
      "en",
      NOW,
    );
    expect(text).toContain("collision : D1 · db/migrations/0042.sql · probable · your two agents");
  });
});
