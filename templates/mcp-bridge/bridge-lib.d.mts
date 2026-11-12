/**
 * Type declarations for `bridge-lib.mjs` — the pure core of the local MCP
 * bridge. The implementation is plain ESM JavaScript; this file only exists
 * so that TypeScript (tsc, the vitest suite) can import it.
 */

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export declare const TOOL_SPECS: ToolSpec[];
export declare const SERVER_INFO: { name: string; version: string };
export declare const PROTOCOL_VERSION: string;

export declare function needsRepo(toolName: string): boolean;

export declare function handleRpc(
  msg: {
    id?: number | string;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  } | null,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  defaultRepo?: string,
): Promise<Record<string, unknown> | null>;
