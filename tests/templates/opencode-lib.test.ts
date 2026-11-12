/**
 * tests/templates/opencode-lib.test.ts — unit tests for the pure helper
 * library of the OpenCode plugin (`templates/opencode/chantiers-lib.mjs`).
 *
 * No network, no OpenCode runtime: the library is pure, so the whole HTTP
 * contract (the exact body shapes of /open, /touch and /close, and the parsing
 * of the app's answer) is asserted here.
 *
 * The library is an ES module; the test file is compiled as CommonJS by the
 * repository (`module: node16`), so the import is dynamic — the recommended
 * way to load an ES module from CommonJS.
 */

import { beforeAll, describe, expect, it } from "vitest";

type Lib = typeof import("../../templates/opencode/chantiers-lib.mjs", {
  with: { "resolution-mode": "import" },
});

let lib!: Lib;

beforeAll(async () => {
  lib = await import("../../templates/opencode/chantiers-lib.mjs");
});

describe("extractFilePath", () => {
  it("reads filePath (Claude Code style)", () => {
    expect(lib.extractFilePath("write", { filePath: "src/a.ts" })).toBe("src/a.ts");
  });

  it("reads file_path (hook style)", () => {
    expect(lib.extractFilePath("edit", { file_path: "src/b.ts" })).toBe("src/b.ts");
  });

  it("reads path (the real opencode v2 write tool)", () => {
    expect(lib.extractFilePath("write", { path: "/repo/src/c.ts", content: "x" })).toBe("/repo/src/c.ts");
  });

  it("returns undefined for bash", () => {
    expect(lib.extractFilePath("bash", { command: "ls", file_path: "src/a.ts" })).toBeUndefined();
  });

  it("returns undefined for an unknown tool", () => {
    expect(lib.extractFilePath("read", { filePath: "src/a.ts" })).toBeUndefined();
  });

  it("returns undefined when the tool carries no path", () => {
    expect(lib.extractFilePath("edit", { old_string: "a" })).toBeUndefined();
  });

  it("returns undefined for a missing argument object", () => {
    expect(lib.extractFilePath("write", undefined)).toBeUndefined();
  });
});

describe("ticketKeyOf", () => {
  it("finds the ticket key in a feature branch", () => {
    expect(lib.ticketKeyOf("feature/PROJ-123-x")).toBe("PROJ-123");
  });

  it("finds the ticket key in a plain branch name", () => {
    expect(lib.ticketKeyOf("PROJ-123")).toBe("PROJ-123");
  });

  it("accepts a one-digit number", () => {
    expect(lib.ticketKeyOf("fix/ABC-9")).toBe("ABC-9");
  });

  it("returns undefined on a branch without a ticket", () => {
    expect(lib.ticketKeyOf("main")).toBeUndefined();
  });

  it("returns undefined on a lowercase key", () => {
    expect(lib.ticketKeyOf("feature/proj-123")).toBeUndefined();
  });
});

describe("body builders — the exact web-trigger contract", () => {
  it("builds the /open body", () => {
    expect(lib.buildOpenBody("sess-1", "feature/PROJ-123-x", "/repo")).toEqual({
      sessionRef: "sess-1",
      branch: "feature/PROJ-123-x",
      cwd: "/repo",
    });
  });

  it("builds the /touch body — nothing but the path", () => {
    const body = lib.buildTouchBody("sess-1", "/repo/src/a.ts", "/repo");
    expect(body).toEqual({
      session_id: "sess-1",
      tool_input: { file_path: "/repo/src/a.ts" },
      cwd: "/repo",
      hook_event_name: "PreToolUse",
    });
    expect(Object.keys(body).sort()).toEqual(["cwd", "hook_event_name", "session_id", "tool_input"]);
    expect(Object.keys(body.tool_input)).toEqual(["file_path"]);
    expect(lib.TOUCH_EVENT_NAME).toBe("PreToolUse");
  });

  it("builds the /close body", () => {
    expect(lib.buildCloseBody("sess-1", "opencode-plugin-unload")).toEqual({
      sessionRef: "sess-1",
      reason: "opencode-plugin-unload",
    });
  });

  it("omits an empty close reason", () => {
    expect(lib.buildCloseBody("sess-1")).toEqual({ sessionRef: "sess-1" });
  });
});

describe("parseHookResponse", () => {
  it("reads additionalContext", () => {
    const json = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "verdict: free" } };
    expect(lib.parseHookResponse(json)).toEqual({ context: "verdict: free" });
  });

  it("reads a deny decision and its reason", () => {
    const json = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "zone frozen",
      },
    };
    expect(lib.parseHookResponse(json)).toEqual({ deny: true, reason: "zone frozen" });
  });

  it("returns nothing for an empty answer", () => {
    expect(lib.parseHookResponse(undefined)).toEqual({});
    expect(lib.parseHookResponse("")).toEqual({});
    expect(lib.parseHookResponse({})).toEqual({});
  });

  it("returns nothing for invalid JSON", () => {
    expect(lib.parseHookResponse("{not json")).toEqual({});
  });

  it("accepts a raw body as a string", () => {
    const raw = JSON.stringify({ hookSpecificOutput: { additionalContext: "verdict: wait" } });
    expect(lib.parseHookResponse(raw)).toEqual({ context: "verdict: wait" });
  });

  it("gives a deny without a reason a default one", () => {
    const json = { hookSpecificOutput: { permissionDecision: "deny" } };
    expect(lib.parseHookResponse(json).deny).toBe(true);
    expect(lib.parseHookResponse(json).reason).toBe("edit blocked by the app");
  });
});
