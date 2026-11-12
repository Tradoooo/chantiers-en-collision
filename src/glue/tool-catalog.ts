/**
 * glue/tool-catalog.ts — the SINGLE source of truth for the 16 MCP tools.
 *
 * Every other surface that names these tools reads from here (or is generated
 * from here), so adding a tool happens at exactly one place:
 *   - scripts/check-manifest.mjs (CI gate) imports TOOL_KEYS;
 *   - manifest.yml `rovo:mcp` is generated from the catalog (gen-manifest);
 *   - the README table and prove.py counter are the remaining consumers.
 *
 * This module is deliberately dependency-free (no ../core/types or sibling
 * import): it must stay loadable by `node scripts/check-manifest.mjs` via
 * Node's built-in type stripping, which cannot resolve the extensionless
 * barrel imports used elsewhere in src/.
 *
 * Pure, erasable TypeScript only (interfaces + annotated literals), so it
 * parses both under `tsc --noEmit` and Node's type stripper.
 */

/** The only input types a Forge action may carry (simple values only). */
export type MCPInputType = "string" | "integer" | "number" | "boolean";

/** One essential input of a tool (`paths` is one string, one path per line). */
export interface ToolInput {
  name: string;
  type: MCPInputType;
  required: boolean;
}

/** A single MCP tool: its action key, human name, what it does, its inputs. */
export interface MCPTool {
  /** Tool key — also the `action` key and the `rovo:mcp[0].tools` entry. */
  key: string;
  /** Human name shown to agents. */
  name: string;
  /** One-line description (agents rely on it to pick the right tool). */
  description: string;
  /** Essential inputs, in declaration order. */
  inputs: ToolInput[];
}

export const TOOL_CATALOG: readonly MCPTool[] = [
  {
    key: "declare-footprint",
    name: "Declare footprint",
    description:
      "Declare the repo paths you are about to touch; get a verdict (free/caution/wait/stop), every collision, the neighbour's name and what to do instead.",
    inputs: [
      { name: "issueKey", type: "string", required: true },
      { name: "repo", type: "string", required: true },
      { name: "paths", type: "string", required: true },
      { name: "mode", type: "string", required: false },
      { name: "etaMinutes", type: "integer", required: false },
      { name: "session", type: "string", required: false },
    ],
  },
  {
    key: "check-zone",
    name: "Check zone",
    description: "Verdict for paths without declaring anything.",
    inputs: [
      { name: "repo", type: "string", required: true },
      { name: "paths", type: "string", required: true },
      { name: "issueKey", type: "string", required: false },
    ],
  },
  {
    key: "who-touches",
    name: "Who touches",
    description: "Worksites currently present on a path, with state and last activity.",
    inputs: [
      { name: "repo", type: "string", required: true },
      { name: "path", type: "string", required: true },
    ],
  },
  {
    key: "get-worksite",
    name: "Get worksite",
    description: "Full panel data for a ticket: footprint by source, neighbours, collisions, notices.",
    inputs: [{ name: "issueKey", type: "string", required: true }],
  },
  {
    key: "predict-footprint",
    name: "Predict footprint",
    description:
      "Predicted footprint from the component and similar merged tickets; never blocking, shown with its confidence.",
    inputs: [{ name: "issueKey", type: "string", required: true }],
  },
  {
    key: "list-collisions",
    name: "List collisions",
    description: "Colliding pairs for the tickets matched by a JQL query, with degree and state.",
    inputs: [{ name: "jql", type: "string", required: true }],
  },
  {
    key: "list-clear-work",
    name: "List clear work",
    description: "Ready tickets nobody collides with — what an idle agent can start now.",
    inputs: [
      { name: "jql", type: "string", required: true },
      { name: "session", type: "string", required: false },
    ],
  },
  {
    key: "next-clear-ticket",
    name: "Next clear ticket",
    description:
      "The dispatcher: THE next ticket this worker can start, ranked by priority and due date, with two alternatives.",
    inputs: [
      { name: "jql", type: "string", required: true },
      { name: "session", type: "string", required: false },
    ],
  },
  {
    key: "plan-parallel-work",
    name: "Plan parallel work",
    description:
      "Split the tickets of a JQL query into collision-free waves for N workers; hinges go alone and first.",
    inputs: [
      { name: "jql", type: "string", required: true },
      { name: "workers", type: "integer", required: true },
    ],
  },
  {
    key: "measure-parallel-width",
    name: "Measure parallel width",
    description:
      "How many agents this repo supports at once, the bottleneck zones, and what splitting the top bottleneck would buy.",
    inputs: [
      { name: "jql", type: "string", required: false },
      { name: "repo", type: "string", required: false },
    ],
  },
  {
    key: "reserve-zone",
    name: "Reserve zone",
    description: "Reserve paths for a limited time (120 min default, 1440 max). Always expires.",
    inputs: [
      { name: "issueKey", type: "string", required: true },
      { name: "repo", type: "string", required: true },
      { name: "paths", type: "string", required: true },
      { name: "minutes", type: "integer", required: false },
      { name: "reason", type: "string", required: false },
    ],
  },
  {
    key: "post-notice",
    name: "Post notice",
    description: "Send a short notice to neighbouring worksites; delivered once per session.",
    inputs: [
      { name: "issueKey", type: "string", required: true },
      { name: "paths", type: "string", required: true },
      { name: "text", type: "string", required: true },
    ],
  },
  {
    key: "resolve-collision",
    name: "Resolve collision",
    description:
      "Record how a collision is handled: wait, sequence, coordinate, split, merge or override.",
    inputs: [
      { name: "collisionId", type: "string", required: true },
      { name: "choice", type: "string", required: true },
      { name: "reason", type: "string", required: false },
    ],
  },
  {
    key: "close-worksite",
    name: "Close worksite",
    description: "Close a worksite (merged / abandoned / done) and release the waiting neighbours.",
    inputs: [
      { name: "issueKey", type: "string", required: true },
      { name: "session", type: "string", required: false },
      { name: "outcome", type: "string", required: false },
    ],
  },
  {
    key: "report-conflict",
    name: "Report conflict",
    description: "Report a real merge/rebase conflict so the app learns whether it saw it coming.",
    inputs: [
      { name: "issueKey", type: "string", required: true },
      { name: "repo", type: "string", required: true },
      { name: "paths", type: "string", required: true },
      { name: "withIssueKey", type: "string", required: false },
    ],
  },
  {
    key: "create-hook-token",
    name: "Create hook token",
    description:
      "Create a personal or project hook token (shown once) — the entry pass for the hook, the watcher and the CI step.",
    inputs: [{ name: "scope", type: "string", required: false }],
  },
];

/** The 16 tool keys, in manifest order. */
export const TOOL_KEYS: readonly string[] = TOOL_CATALOG.map((tool) => tool.key);