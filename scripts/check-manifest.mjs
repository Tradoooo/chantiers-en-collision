#!/usr/bin/env node
/**
 * check-manifest.mjs — CI gate for manifest.yml.
 *
 * Validates what we are sure about (no network, no forge CLI needed):
 *  - YAML parses; runtime is nodejs22.x
 *  - exactly one rovo:mcp module, name ≤ 30 chars, ≤ 50 tools
 *  - every tool key is declared under modules.action, with a valid
 *    actionVerb, description, function key and typed inputs
 *  - every referenced function exists under modules.function with an
 *    index.<name> handler
 *  - scheduledTrigger: ≤ 5 entries, known intervals
 *  - webtrigger ingest present with urlFormat v2 + dynamic response
 *
 * Deeper schema validation is `forge lint` (run locally; see README).
 */
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { TOOL_KEYS } from "../src/glue/tool-catalog.ts";

const errors = [];
const warns = [];
const err = (m) => errors.push(m);

// Single source of truth: src/glue/tool-catalog.ts. The gate checks that
// manifest.yml's `rovo:mcp[0].tools` stays faithful to the catalog (never the
// other way around). Node ≥ 22.18 strips the types when loading the .ts.
const EXPECTED_TOOLS = TOOL_KEYS;
const VERBS = new Set(["GET", "CREATE", "UPDATE"]);
const INPUT_TYPES = new Set(["string", "integer", "number", "boolean"]);
const INTERVALS = new Set(["fiveMinute", "hour", "day", "week"]);

let doc;
try {
  doc = load(readFileSync(new URL("../manifest.yml", import.meta.url), "utf8"));
} catch (e) {
  console.error(`manifest.yml does not parse: ${e.message}`);
  process.exit(1);
}

const modules = doc?.modules ?? {};

// runtime
if (doc?.runtime?.name !== "nodejs22.x" && doc?.app?.runtime?.name !== "nodejs22.x") {
  err("runtime must be nodejs22.x");
}

// rovo:mcp
const mcp = modules["rovo:mcp"] ?? [];
if (mcp.length !== 1) err("exactly one rovo:mcp module is required");
const server = mcp[0] ?? {};
if (typeof server.name === "string" && server.name.length > 30) {
  err(`rovo:mcp name exceeds 30 chars: "${server.name}"`);
}
const tools = server.tools ?? [];
if (tools.length > 50) err("rovo:mcp allows at most 50 tools");
for (const t of EXPECTED_TOOLS) {
  if (!tools.includes(t)) err(`missing MCP tool: ${t}`);
}
for (const t of tools) {
  if (!EXPECTED_TOOLS.includes(t)) warns.push(`unexpected MCP tool: ${t}`);
}

// actions
const actions = modules.action ?? [];
const actionByKey = new Map(actions.map((a) => [a.key, a]));
for (const t of tools) {
  const a = actionByKey.get(t);
  if (!a) { err(`tool "${t}" has no modules.action entry`); continue; }
  if (!VERBS.has(a.actionVerb)) err(`action ${t}: actionVerb must be GET/CREATE/UPDATE`);
  if (!a.description || String(a.description).trim().length < 10) {
    err(`action ${t}: description is required (agents rely on it)`);
  }
  if (!a.function) err(`action ${t}: function key is required`);
  for (const [name, input] of Object.entries(a.inputs ?? {})) {
    if (!INPUT_TYPES.has(input?.type)) {
      err(`action ${t}: input "${name}" type must be one of ${[...INPUT_TYPES]}`);
    }
    if (typeof input?.required !== "boolean") err(`action ${t}: input "${name}" needs required: true|false`);
  }
}
const keys = new Set();
for (const a of actions) {
  if (keys.has(a.key)) err(`duplicate action key: ${a.key}`);
  keys.add(a.key);
  if (a.key && a.key.length > 64) err(`action key over 64 chars: ${a.key}`);
}

// functions
const functions = modules.function ?? [];
const fnKeys = new Set(functions.map((f) => f.key));
for (const f of functions) {
  if (!/^index\.[A-Za-z0-9_]+$/.test(f.handler ?? "")) {
    err(`function ${f.key}: handler must look like index.<exportedName>`);
  }
  if ((f.key ?? "").length > 23) {
    err(`function key over 23 chars (forge lint valid-module-required): ${f.key}`);
  }
}
const referenced = [];
for (const a of actions) if (a.function) referenced.push([`action ${a.key}`, a.function]);
for (const wt of modules.webtrigger ?? []) referenced.push([`webtrigger ${wt.key}`, wt.function]);
for (const st of modules.scheduledTrigger ?? []) referenced.push([`scheduledTrigger ${st.key}`, st.function]);
for (const tr of modules.trigger ?? []) referenced.push([`trigger ${tr.key}`, tr.function]);
for (const jq of modules["jira:jqlFunction"] ?? []) referenced.push([`jqlFunction ${jq.key}`, jq.function]);
for (const [who, fn] of referenced) {
  if (!fnKeys.has(fn)) err(`${who} references unknown function "${fn}"`);
}

// webtrigger
const wt = (modules.webtrigger ?? []).find((w) => w.key === "ingest");
if (!wt) {
  err("webtrigger with key 'ingest' is required (hook + CI entry point)");
} else {
  if (wt.urlFormat !== "v2") err("webtrigger ingest: urlFormat must be v2");
  if (wt.response?.type !== "dynamic") err("webtrigger ingest: response.type must be dynamic");
}

// scheduledTrigger
const scheds = modules.scheduledTrigger ?? [];
if (scheds.length > 5) err("at most 5 scheduledTrigger entries per app");
for (const s of scheds) {
  if (!INTERVALS.has(s.interval)) err(`scheduledTrigger ${s.key}: unknown interval "${s.interval}"`);
}

if (warns.length) console.warn(`WARN:\n  ${warns.join("\n  ")}`);
if (errors.length) {
  console.error(`manifest.yml: ${errors.length} error(s):\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`manifest.yml OK — ${tools.length} MCP tools, ${actions.length} actions, ${functions.length} functions`);
