#!/usr/bin/env node
/**
 * mcp-bridge.mjs — a local MCP (stdio) server that bridges to the deployed
 * "Chantiers en collision" app over the ingest web trigger's /tool route.
 *
 * WHY: any MCP client can then call the app's 16 tools with a personal hook
 * token — no Atlassian OAuth dance, no per-client integration:
 *   ZeroClaw agents (the inferhub gateway fleet), Claude Code, Cursor, …
 *
 * CONFIG (environment):
 *   CHANTIER_URL     base web trigger URL, WITHOUT the route (required)
 *   CHANTIER_TOKEN   personal Bearer token (required)
 *   CHANTIER_REPO    default repository slug injected into tool payloads
 *
 * TRANSPORT: MCP stdio — one JSON-RPC message per line on stdin, answers on
 * stdout. Diagnostics go to stderr (never stdout: it is the protocol channel).
 */

import { createInterface } from "node:readline";
import { handleRpc } from "./bridge-lib.mjs";

const BASE = (process.env.CHANTIER_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.CHANTIER_TOKEN ?? "";
const REPO = process.env.CHANTIER_REPO;

if (BASE === "" || TOKEN === "") {
  process.stderr.write(
    "chantiers-mcp-bridge: CHANTIER_URL and CHANTIER_TOKEN are required\n",
  );
  process.exit(2);
}

async function callTool(name, args) {
  const res = await fetch(`${BASE}/tool`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(REPO === undefined ? {} : { "X-Chantier-Repo": REPO }),
    },
    body: JSON.stringify({ tool: name, payload: args }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

// Serialize the answers: MCP clients expect one reply per id, in order.
let chain = Promise.resolve();
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  chain = chain.then(async () => {
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    try {
      const reply = await handleRpc(msg, callTool, REPO);
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
    } catch (e) {
      process.stderr.write(`chantiers-mcp-bridge: ${e?.message ?? e}\n`);
    }
  });
});
