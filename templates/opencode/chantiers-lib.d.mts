/**
 * Type declarations for `chantiers-lib.mjs` — the pure helper library of the
 * OpenCode plugin. The implementation is plain ESM JavaScript; this file only
 * exists so that TypeScript (tsc, the vitest suite) can import it.
 *
 * The body builders are not declared here any more: they are re-exported from
 * the shared module `templates/chantiers-lib/payload.mjs`, where the shape of
 * every emitted emprise lives.
 */

export {
  TOUCH_EVENT_NAME,
  buildCloseBody,
  buildHookHeaders,
  buildOpenBody,
  buildTouchBody,
  defaultSession,
  joinPaths,
} from "../chantiers-lib/payload.mjs";

export declare const WRITE_TOOLS: readonly string[];
export declare const PATH_KEYS: readonly string[];

export declare function extractFilePath(toolName: string, args: unknown): string | undefined;

export declare function ticketKeyOf(branch: string): string | undefined;

export declare function parseHookResponse(json: unknown): {
  context?: string;
  deny?: boolean;
  reason?: string;
};
