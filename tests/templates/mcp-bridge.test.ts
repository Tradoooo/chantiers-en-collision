/**
 * tests/templates/mcp-bridge.test.ts — the local MCP bridge: JSON-RPC
 * handling, tool catalog, repo injection, error shaping. The transport
 * (fetch) is injected, so no network and no app deployment needed.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

type Lib = typeof import("../../templates/mcp-bridge/bridge-lib.mjs", {
  with: { "resolution-mode": "import" },
});

let lib!: Lib;

beforeAll(async () => {
  lib = await import("../../templates/mcp-bridge/bridge-lib.mjs");
});

/** The bridge answers a plain JSON-RPC record; tests read it loosely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reply = any;

async function rpc(
  msg: Record<string, unknown>,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  repo?: string,
): Promise<Reply> {
  return (await lib.handleRpc(msg, callTool, repo)) as Reply;
}

describe("tool catalog", () => {
  it("exposes the 16 tools of the app", () => {
    expect(lib.TOOL_SPECS).toHaveLength(16);
    const names = lib.TOOL_SPECS.map((t) => t.name);
    for (const expected of [
      "declare-footprint",
      "check-zone",
      "who-touches",
      "get-worksite",
      "predict-footprint",
      "list-collisions",
      "list-clear-work",
      "next-clear-ticket",
      "plan-parallel-work",
      "measure-parallel-width",
      "reserve-zone",
      "post-notice",
      "resolve-collision",
      "close-worksite",
      "report-conflict",
      "create-hook-token",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("gives every tool a description and a JSON schema", () => {
    for (const tool of lib.TOOL_SPECS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("handleRpc", () => {
  it("answers initialize with the protocol version and server info", async () => {
    const reply = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, async () => ({}));
    expect(reply.result.protocolVersion).toBe(lib.PROTOCOL_VERSION);
    expect(reply.result.serverInfo.name).toBe("chantiers-en-collision");
    expect(reply.result.capabilities.tools).toEqual({});
  });

  it("lists the tools", async () => {
    const reply = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, async () => ({}));
    expect(reply.result.tools).toHaveLength(16);
  });

  it("calls the tool and wraps the answer as MCP content", async () => {
    const callTool = vi.fn(async () => ({ tool: "declare-footprint", text: "verdict : caution" }));
    const reply = await rpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "declare-footprint", arguments: { issueKey: "PROJ-88", paths: "src/a.ts" } },
      },
      callTool,
      "acme/billing",
    );
    expect(callTool).toHaveBeenCalledTimes(1);
    const [name, args] = callTool.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("declare-footprint");
    expect(args.repo).toBe("acme/billing");
    expect(reply.result.content[0].text).toContain("verdict : caution");
    expect(reply.result.isError).toBe(false);
  });

  it("does not override a repo given in the arguments", async () => {
    const callTool = vi.fn(async () => ({ text: "ok" }));
    await rpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "declare-footprint", arguments: { repo: "acme/other" } },
      },
      callTool,
      "acme/billing",
    );
    const [, args] = callTool.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args.repo).toBe("acme/other");
  });

  it("turns a tool failure into an MCP error content, not a crash", async () => {
    const reply = await rpc(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "declare-footprint", arguments: {} },
      },
      async () => {
        throw new Error("HTTP 401: unauthorized");
      },
    );
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain("401");
  });

  it("answers unknown methods with a JSON-RPC error", async () => {
    const reply = await rpc({ jsonrpc: "2.0", id: 6, method: "nope" }, async () => ({}));
    expect(reply.error.code).toBe(-32601);
  });

  it("ignores notifications (no id)", async () => {
    const reply = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, async () => ({}));
    expect(reply).toBeNull();
  });
});
