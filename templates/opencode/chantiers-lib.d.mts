/**
 * Type declarations for `chantiers-lib.mjs` — the pure helper library of the
 * OpenCode plugin. The implementation is plain ESM JavaScript; this file only
 * exists so that TypeScript (tsc, the vitest suite) can import it.
 */

export declare const WRITE_TOOLS: readonly string[];
export declare const PATH_KEYS: readonly string[];
export declare const TOUCH_EVENT_NAME: string;

export declare function extractFilePath(toolName: string, args: unknown): string | undefined;

export declare function ticketKeyOf(branch: string): string | undefined;

export declare function buildOpenBody(
  sessionRef: string,
  branch: string,
  cwd: string,
): { sessionRef: string; branch: string; cwd: string };

export declare function buildTouchBody(
  sessionRef: string,
  filePath: string,
  cwd: string,
): {
  session_id: string;
  tool_input: { file_path: string };
  cwd: string;
  hook_event_name: string;
};

export declare function buildCloseBody(
  sessionRef: string,
  reason?: string,
): { sessionRef: string; reason?: string };

export declare function parseHookResponse(json: unknown): {
  context?: string;
  deny?: boolean;
  reason?: string;
};
