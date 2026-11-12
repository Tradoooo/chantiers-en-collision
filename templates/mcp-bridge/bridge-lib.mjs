/**
 * bridge-lib.mjs — the pure core of the local MCP bridge: the tool catalog
 * (mirrors manifest.yml) and the JSON-RPC handling. No I/O, no network —
 * everything injectable, fully unit-tested (tests/templates/mcp-bridge.test.ts).
 *
 * The bridge exposes the app's tools to ANY local MCP client (ZeroClaw agents
 * on the inferhub gateway, Claude Code, …) without the platform OAuth dance:
 * it authenticates with a personal hook token over the ingest web trigger's
 * /tool route. Identity = the token, never the payload.
 */

/** The 16 tools of manifest.yml, with minimal JSON schemas. */
export const TOOL_SPECS = [
  {
    name: "declare-footprint",
    description:
      "Declare the paths this worksite is about to touch; get a verdict (free/caution/wait/stop), every collision, the neighbour's name and what to do instead.",
    inputSchema: {
      type: "object",
      properties: {
        issueKey: { type: "string", description: "Jira issue key, e.g. PROJ-88" },
        repo: { type: "string", description: "Repository slug, e.g. acme/billing" },
        paths: { type: "string", description: "One path per line (files, folders, globs)" },
        mode: { type: "string", enum: ["edit", "create", "delete", "rename"] },
        etaMinutes: { type: "integer" },
        session: { type: "string", description: "Agent session reference" },
      },
      required: ["issueKey", "paths"],
    },
  },
  {
    name: "check-zone",
    description: "Verdict for paths WITHOUT declaring anything.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        paths: { type: "string", description: "One path per line" },
        issueKey: { type: "string" },
      },
      required: ["paths"],
    },
  },
  {
    name: "who-touches",
    description: "Worksites currently present on a path, with state and last activity.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string" }, path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "get-worksite",
    description: "Full panel data for a ticket: footprint by source, neighbours, collisions, notices.",
    inputSchema: {
      type: "object",
      properties: { issueKey: { type: "string" } },
      required: ["issueKey"],
    },
  },
  {
    name: "predict-footprint",
    description: "Predicted footprint from component + similar merged tickets (never blocking).",
    inputSchema: {
      type: "object",
      properties: { issueKey: { type: "string" } },
      required: ["issueKey"],
    },
  },
  {
    name: "list-collisions",
    description: "Colliding pairs for the tickets matched by a JQL query.",
    inputSchema: {
      type: "object",
      properties: { jql: { type: "string" } },
      required: ["jql"],
    },
  },
  {
    name: "list-clear-work",
    description: "Ready tickets nobody collides with — what an idle agent can start now.",
    inputSchema: {
      type: "object",
      properties: { jql: { type: "string" }, session: { type: "string" } },
      required: ["jql"],
    },
  },
  {
    name: "next-clear-ticket",
    description: "The dispatcher: THE next ticket this worker can start, ranked, with alternatives.",
    inputSchema: {
      type: "object",
      properties: { jql: { type: "string" }, session: { type: "string" } },
      required: ["jql"],
    },
  },
  {
    name: "plan-parallel-work",
    description: "Split the tickets of a JQL query into collision-free waves for N workers.",
    inputSchema: {
      type: "object",
      properties: { jql: { type: "string" }, workers: { type: "integer" } },
      required: ["jql", "workers"],
    },
  },
  {
    name: "measure-parallel-width",
    description: "How many agents this repo supports at once, its bottlenecks, and what a split would buy.",
    inputSchema: {
      type: "object",
      properties: { jql: { type: "string" }, repo: { type: "string" } },
    },
  },
  {
    name: "reserve-zone",
    description: "Reserve paths for a limited time (120 min default, 1440 max). Always expires.",
    inputSchema: {
      type: "object",
      properties: {
        issueKey: { type: "string" },
        repo: { type: "string" },
        paths: { type: "string" },
        minutes: { type: "integer" },
        reason: { type: "string" },
      },
      required: ["issueKey", "paths"],
    },
  },
  {
    name: "post-notice",
    description: "Send a short notice to neighbouring worksites; delivered once per session.",
    inputSchema: {
      type: "object",
      properties: {
        issueKey: { type: "string" },
        paths: { type: "string" },
        text: { type: "string" },
      },
      required: ["issueKey", "paths", "text"],
    },
  },
  {
    name: "resolve-collision",
    description: "Record how a collision is handled: wait, sequence, coordinate, split, merge, override.",
    inputSchema: {
      type: "object",
      properties: {
        collisionId: { type: "string" },
        choice: {
          type: "string",
          enum: ["wait", "sequence", "coordinate", "split", "merge", "override"],
        },
        reason: { type: "string" },
      },
      required: ["collisionId", "choice"],
    },
  },
  {
    name: "close-worksite",
    description: "Close a worksite (merged/abandoned/done) and release the waiting neighbours.",
    inputSchema: {
      type: "object",
      properties: {
        issueKey: { type: "string" },
        session: { type: "string" },
        outcome: { type: "string", enum: ["merged", "abandoned", "done"] },
      },
      required: ["issueKey"],
    },
  },
  {
    name: "report-conflict",
    description: "Report a real merge/rebase conflict so the app learns whether it saw it coming.",
    inputSchema: {
      type: "object",
      properties: {
        issueKey: { type: "string" },
        repo: { type: "string" },
        paths: { type: "string" },
        withIssueKey: { type: "string" },
      },
      required: ["issueKey", "paths"],
    },
  },
  {
    name: "create-hook-token",
    description: "Create a personal or project hook token (shown once).",
    inputSchema: {
      type: "object",
      properties: { scope: { type: "string", enum: ["personal", "project"] } },
    },
  },
];

export const SERVER_INFO = { name: "chantiers-en-collision", version: "1.0.0" };
export const PROTOCOL_VERSION = "2024-11-05";

function errorReply(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Handle one JSON-RPC request. `callTool(name, args)` performs the HTTP call
 * and resolves to the app's ToolResult ({tool, text, ...}). Notifications
 * (no id) return null — nothing to send.
 */
export async function handleRpc(msg, callTool, defaultRepo) {
  const { id, method, params } = msg ?? {};
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }
  if (method === "notifications/initialized" || id === undefined) return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOL_SPECS } };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = { ...(params?.arguments ?? {}) };
    if (defaultRepo && args.repo === undefined && needsRepo(name)) args.repo = defaultRepo;
    try {
      const result = await callTool(name, args);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: result?.text ?? JSON.stringify(result ?? {}) }],
          isError: false,
          structured: result,
        },
      };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `chantiers bridge error: ${e?.message ?? e}` }],
          isError: true,
        },
      };
    }
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (id === undefined) return null;
  return errorReply(id, -32601, `method not found: ${method}`);
}

const REPO_TOOLS = new Set([
  "declare-footprint",
  "check-zone",
  "who-touches",
  "reserve-zone",
  "report-conflict",
  "measure-parallel-width",
]);

export function needsRepo(toolName) {
  return REPO_TOOLS.has(toolName);
}
