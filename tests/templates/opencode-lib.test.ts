/**
 * tests/templates/opencode-lib.test.ts — unit tests for the pure helper
 * library of the OpenCode plugin (`templates/opencode/chantiers-lib.mjs`).
 *
 * No network, no OpenCode runtime: the library is pure, so the parsing of the
 * app's answer is asserted here. The exact body shapes of /open, /touch and
 * /close are asserted once, in `tests/templates/payload.test.ts`, where the
 * shared module that builds them lives.
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

describe("body builders — re-exported from the shared core", () => {
  // The shapes of /open, /touch and /close are built by the shared module
  // `templates/chantiers-lib/payload.mjs` — the watcher, the plugin and the
  // CI templates all use it. They are asserted ONCE, in
  // `tests/templates/payload.test.ts`; here we only check that the plugin
  // still hands them over.
  it("exposes the shared payload builders", () => {
    expect(typeof lib.buildOpenBody).toBe("function");
    expect(typeof lib.buildTouchBody).toBe("function");
    expect(typeof lib.buildCloseBody).toBe("function");
    expect(typeof lib.buildHookHeaders).toBe("function");
    expect(typeof lib.defaultSession).toBe("function");
    expect(lib.TOUCH_EVENT_NAME).toBe("PreToolUse");
  });
});

describe("parseHookResponse", () => {
  it("is re-exported from the shared payload module", () => {
    expect(typeof lib.parseHookResponse).toBe("function");
  });
});
