import { describe, expect, it } from "vitest";
import { advanceOf, whoYields } from "../../src/core/priority";
import { DEFAULT_PRIORITY_RULES } from "../../src/core/types";
import type { PriorityCriterion, PriorityRules, YieldContext } from "../../src/core/types";

function rules(over: Partial<PriorityRules> = {}): PriorityRules {
  return { projectId: "proj-1", ...DEFAULT_PRIORITY_RULES, ...over };
}

function ordered(order: PriorityCriterion[], agentYields = true): PriorityRules {
  return rules({ order, agentYields });
}

/** Neutral side: plain human, no reservation, no incident, active, mid-day. */
function side(over: Partial<YieldContext> = {}): YieldContext {
  return {
    worksiteId: "ws-a",
    kind: "human",
    hasActiveReservation: false,
    incident: false,
    advance: 1,
    arrivedAt: "2026-11-02T10:00:00.000Z",
    ...over,
  };
}

const EARLY = "2026-11-01T08:00:00.000Z";
const LATE = "2026-11-03T18:00:00.000Z";

describe("whoYields — one criterion at a time", () => {
  it("a live reservation beats everything else", () => {
    const a = side({ hasActiveReservation: true, priorityRank: 9, arrivedAt: LATE });
    const b = side({ priorityRank: 1, arrivedAt: EARLY });
    expect(whoYields(a, b, rules())).toBe("b");
    expect(whoYields(b, a, rules())).toBe("a");
  });

  it("an open incident beats the ticket priority", () => {
    const a = side({ incident: true, priorityRank: 9, dueAt: "2027-01-01T00:00:00.000Z" });
    const b = side({ priorityRank: 1, dueAt: "2026-11-05T00:00:00.000Z" });
    expect(whoYields(a, b, rules())).toBe("b");
  });

  it("the lowest priority rank wins", () => {
    const a = side({ priorityRank: 2 });
    const b = side({ priorityRank: 4 });
    expect(whoYields(a, b, rules())).toBe("b");
    expect(whoYields(b, a, rules())).toBe("a");
  });

  it("an undefined priority rank is the worst possible", () => {
    const a = side({});
    const b = side({ priorityRank: 9 });
    expect(whoYields(a, b, rules())).toBe("a");
    expect(whoYields(b, a, rules())).toBe("b");
  });

  it("the nearest due date wins, an undefined due date is the worst", () => {
    const soon = side({ dueAt: "2026-11-06T00:00:00.000Z" });
    const later = side({ dueAt: "2026-11-20T00:00:00.000Z" });
    expect(whoYields(soon, later, rules())).toBe("b");
    expect(whoYields(later, soon, rules())).toBe("a");
    expect(whoYields(side({}), soon, rules())).toBe("a");
    expect(whoYields(soon, side({}), rules())).toBe("b");
  });

  it("the most advanced worksite wins (PR > active > declared)", () => {
    const pr = side({ advance: 2 });
    const declared = side({ advance: 0 });
    expect(whoYields(pr, declared, rules())).toBe("b");
    expect(whoYields(declared, side({ advance: 1 }), rules())).toBe("a");
  });

  it("the first arrived wins", () => {
    const first = side({ arrivedAt: EARLY });
    const second = side({ arrivedAt: LATE });
    expect(whoYields(first, second, rules())).toBe("b");
    expect(whoYields(second, first, rules())).toBe("a");
  });

  it("the rule order is respected (incident before reservation)", () => {
    const withReservation = side({ hasActiveReservation: true });
    const withIncident = side({ incident: true });
    expect(whoYields(withReservation, withIncident, rules())).toBe("b");
    expect(
      whoYields(withReservation, withIncident, ordered(["incident", "reservation"])),
    ).toBe("a");
  });

  it("handles a fully custom, reversed order", () => {
    const oldButLowPriority = side({ arrivedAt: EARLY, priorityRank: 9 });
    const newButUrgent = side({ arrivedAt: LATE, priorityRank: 1 });
    expect(whoYields(oldButLowPriority, newButUrgent, ordered(["first", "priority"]))).toBe("b");
    expect(whoYields(oldButLowPriority, newButUrgent, ordered(["priority", "first"]))).toBe("a");
  });
});

describe("whoYields — ties", () => {
  it("on a tie between two humans, the last arrived yields", () => {
    expect(whoYields(side({ arrivedAt: LATE }), side({ arrivedAt: EARLY }), rules())).toBe("a");
    expect(whoYields(side({ arrivedAt: EARLY }), side({ arrivedAt: LATE }), rules())).toBe("b");
  });

  it("on a tie the agent yields to the human", () => {
    const human = side({ arrivedAt: EARLY });
    const agent = side({ kind: "agent", arrivedAt: LATE });
    expect(whoYields(human, agent, rules())).toBe("b");
    expect(whoYields(agent, human, rules())).toBe("a");
  });

  it("a differing arrival still wins over the agent-yields rule", () => {
    const agent = side({ kind: "agent", arrivedAt: EARLY });
    const human = side({ arrivedAt: LATE });
    expect(whoYields(agent, human, rules())).toBe("b");
    expect(whoYields(human, agent, rules())).toBe("a");
  });

  it("with agentYields off, the same full tie goes the other way", () => {
    const agent = side({ kind: "agent" });
    const human = side({});
    expect(whoYields(agent, human, rules())).toBe("a");
    expect(whoYields(agent, human, ordered(DEFAULT_PRIORITY_RULES.order, false))).toBe("b");
  });

  it("two agents tie on the last arrived rule", () => {
    const older = side({ kind: "agent", arrivedAt: EARLY });
    const newer = side({ kind: "agent", arrivedAt: LATE });
    expect(whoYields(older, newer, rules())).toBe("b");
  });

  it("identical contexts still return a side", () => {
    expect(["a", "b"]).toContain(whoYields(side(), side(), rules()));
  });

  it("a tie on one criterion falls through to the next", () => {
    const a = side({ priorityRank: 3, arrivedAt: EARLY });
    const b = side({ priorityRank: 3, arrivedAt: LATE });
    expect(whoYields(a, b, rules())).toBe("b");
  });
});

describe("advanceOf", () => {
  it("counts an open PR and a review as most advanced", () => {
    expect(advanceOf("active", true)).toBe(2);
    expect(advanceOf("review")).toBe(2);
    expect(advanceOf("review", false)).toBe(2);
    expect(advanceOf("planned", true)).toBe(2);
  });

  it("counts a planned worksite as declared only", () => {
    expect(advanceOf("planned")).toBe(0);
    expect(advanceOf("planned", false)).toBe(0);
  });

  it("counts work in progress as one step", () => {
    for (const state of ["open", "active", "paused", "dormant", "closed"]) {
      expect(advanceOf(state)).toBe(1);
    }
  });
});
