/**
 * core/paths — path normalization, classification and overlap semantics.
 * Owner: workstream A. Replace each stub; keep signatures EXACTLY.
 * Pure TS, no imports outside core/types.
 */

import type { PathKind } from "./types";

const TODO = (who: string) => new Error(`TODO(${who}): not implemented — see docs/CONTRACTS.md`);

/**
 * Normalize a raw path: trim, strip "./", strip leading "/", strip trailing
 * "/", collapse duplicate slashes. Returns "" for empty input.
 */
export function normalizePath(_raw: string): string {
  throw TODO("paths");
}

/**
 * Classify a normalized path:
 *  - contains "*" or "?" → "pattern"
 *  - ends with "/" (before normalization) or has no "." in its last segment → "dir"
 *  - otherwise → "file"
 */
export function classifyPath(_p: string): PathKind {
  throw TODO("paths");
}

/** Parent directories of a path, shallowest first: "a/b/c.ts" → ["a", "a/b"]. */
export function parentDirs(_p: string): string[] {
  throw TODO("paths");
}

/**
 * True when `folder` covers `other`:
 *  - dir covers any path starting with "<dir>/"
 *  - file covers the identical path only
 */
export function pathContains(_folder: string, _other: string): boolean {
  throw TODO("paths");
}

/**
 * Glob matching on normalized paths: "**" spans segments, "*" spans one
 * segment, "?" one char. "db/migrations/**" matches "db/migrations/0042.sql".
 */
export function matchesGlob(_pattern: string, _path: string): boolean {
  throw TODO("paths");
}

/**
 * Overlap between two footprint entries (any combination of file/dir/pattern):
 * equality, containment either way, or non-empty glob intersection
 * (for two patterns: a path matching both must be conceivable — literal
 * prefix comparison is enough).
 */
export function entriesOverlap(
  _aPath: string,
  _aKind: PathKind,
  _bPath: string,
  _bKind: PathKind,
): boolean {
  throw TODO("paths");
}
