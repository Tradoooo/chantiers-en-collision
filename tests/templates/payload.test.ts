/**
 * tests/templates/payload.test.ts — the SHARED observation core
 * (`templates/chantiers-lib/payload.mjs`).
 *
 * The watcher, the OpenCode plugin and the CI templates all report what they
 * see to the app through the bodies built HERE: the shape of an emitted
 * emprise is written down once, and tested once. This file is that single
 * test; `tests/templates/opencode-lib.test.ts` only checks that the plugin
 * still re-exports the module.
 *
 * The module is an ES module; the test file is compiled as CommonJS by the
 * repository (`module: node16`), so the import is dynamic — the recommended
 * way to load an ES module from CommonJS.
 */

import { beforeAll, describe, expect, it } from "vitest";

type Payload = typeof import("../../templates/chantiers-lib/payload.mjs", {
  with: { "resolution-mode": "import" },
});

let payload!: Payload;

beforeAll(async () => {
  payload = await import("../../templates/chantiers-lib/payload.mjs");
});

describe("buildOpenBody — the /open contract", () => {
  it("opens a worksite with the session, the branch and the cwd", () => {
    expect(payload.buildOpenBody("sess-1", "feature/PROJ-123-x", "/repo")).toEqual({
      sessionRef: "sess-1",
      branch: "feature/PROJ-123-x",
      cwd: "/repo",
    });
  });

  it("sends nothing but those three fields", () => {
    const body = payload.buildOpenBody("sess-1", "main", "/repo");
    expect(Object.keys(body).sort()).toEqual(["branch", "cwd", "sessionRef"]);
  });
});

describe("buildTouchBody — the /touch contract", () => {
  it("declares the path of the file about to be written", () => {
    const body = payload.buildTouchBody("sess-1", "/repo/src/a.ts", "/repo");
    expect(body).toEqual({
      session_id: "sess-1",
      tool_input: { file_path: "/repo/src/a.ts" },
      cwd: "/repo",
      hook_event_name: "PreToolUse",
    });
  });

  it("never carries the file content", () => {
    const body = payload.buildTouchBody("sess-1", "/repo/src/a.ts", "/repo");
    expect(Object.keys(body).sort()).toEqual(["cwd", "hook_event_name", "session_id", "tool_input"]);
    expect(Object.keys(body.tool_input)).toEqual(["file_path"]);
    expect(payload.TOUCH_EVENT_NAME).toBe("PreToolUse");
  });
});

describe("buildCloseBody — the /close contract", () => {
  it("releases the worksite with a reason", () => {
    expect(payload.buildCloseBody("sess-1", "SIGINT")).toEqual({
      sessionRef: "sess-1",
      reason: "SIGINT",
    });
  });

  it("omits an empty reason", () => {
    expect(payload.buildCloseBody("sess-1")).toEqual({ sessionRef: "sess-1" });
    expect(payload.buildCloseBody("sess-1", "")).toEqual({ sessionRef: "sess-1" });
    expect(payload.buildCloseBody("sess-1", "   ")).toEqual({ sessionRef: "sess-1" });
  });
});

describe("joinPaths — one path per line", () => {
  it("joins an array of paths, one per line", () => {
    expect(payload.joinPaths(["src/a.ts", "src/b.ts"])).toBe("src/a.ts\nsrc/b.ts");
  });

  it("trims the paths and drops the blank lines", () => {
    expect(payload.joinPaths([" src/a.ts ", "", "src/b.ts", "   "])).toBe("src/a.ts\nsrc/b.ts");
  });

  it("accepts an already joined list", () => {
    expect(payload.joinPaths("src/a.ts\nsrc/b.ts")).toBe("src/a.ts\nsrc/b.ts");
  });

  it("returns an empty string for nothing", () => {
    expect(payload.joinPaths(undefined)).toBe("");
    expect(payload.joinPaths([])).toBe("");
  });
});

describe("buildHookHeaders — the token and the repo", () => {
  it("always authenticates with the personal token", () => {
    expect(payload.buildHookHeaders("tok-1")).toEqual({
      authorization: "Bearer tok-1",
      "content-type": "application/json",
    });
  });

  it("adds the repo slug when it is known", () => {
    expect(payload.buildHookHeaders("tok-1", "acme/billing")).toEqual({
      authorization: "Bearer tok-1",
      "content-type": "application/json",
      "x-chantier-repo": "acme/billing",
    });
  });

  it("omits the repo slug when it is empty", () => {
    expect(payload.buildHookHeaders("tok-1", "")).not.toHaveProperty("x-chantier-repo");
    expect(payload.buildHookHeaders("tok-1", "   ")).not.toHaveProperty("x-chantier-repo");
  });
});

describe("defaultSession — the session reference", () => {
  it("is a non-empty string carrying the pid", () => {
    const session = payload.defaultSession();
    expect(session).toContain(String(process.pid));
    expect(session.length).toBeGreaterThan(0);
  });

  it("keeps the namespace of its client", () => {
    expect(payload.defaultSession("oc-").startsWith("oc-")).toBe(true);
  });

  it("is different for two sessions", () => {
    expect(payload.defaultSession()).not.toBe(payload.defaultSession());
  });
});
