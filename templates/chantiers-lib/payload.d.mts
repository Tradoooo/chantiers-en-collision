/**
 * Type declarations for `payload.mjs` — the shared hook-payload builders of
 * every observation client (watcher, OpenCode, CI). The implementation is plain
 * ESM JavaScript; this file only exists so that TypeScript (tsc, the vitest
 * suite) can import it.
 */

export declare const TOUCH_EVENT_NAME: string;

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

export declare function joinPaths(paths: string[] | string | undefined): string;

export declare function buildHookHeaders(
  token: string,
  repoSlug?: string,
): Record<string, string>;

export declare function defaultSession(prefix?: string): string;

export declare const FETCH_TIMEOUT_MS: number;
export declare const CLOSE_TIMEOUT_MS: number;

export declare function postJson(
  base: string,
  route: string,
  body: object,
  opts?: { token: string; repo?: string; timeoutMs?: number },
): Promise<unknown>;

export declare function parseHookResponse(json: unknown): {
  context?: string;
  deny?: boolean;
  reason?: string;
};