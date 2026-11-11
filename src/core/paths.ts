/**
 * core/paths — path normalization, classification and overlap semantics.
 * Pure TS. Glob semantics follow .gitignore conventions:
 *  - "**" spans segments, "*" stays inside one segment, "?" one char;
 *  - a pattern WITHOUT "/" matches the basename at any depth
 *    ("package-lock.json" matches "app/package-lock.json");
 *  - a pattern WITH "/" is anchored at the repo root ("dist/**").
 */

import type { PathKind } from "./types";

/** Trim, strip "./" and "/" prefixes, "/" suffix, collapse duplicate slashes. */
export function normalizePath(raw: string): string {
  let p = raw.trim().replace(/\/{2,}/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  while (p.startsWith("/")) p = p.slice(1);
  while (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** Pattern if it carries glob chars; dir if the last segment has no dot; else file. */
export function classifyPath(p: string): PathKind {
  const n = normalizePath(p);
  if (n === "") return "file";
  if (/[*?]/.test(n)) return "pattern";
  const last = n.split("/").pop() ?? "";
  return last.includes(".") ? "file" : "dir";
}

/** Parent directories, shallowest first: "a/b/c.ts" → ["a", "a/b"]. */
export function parentDirs(p: string): string[] {
  const n = normalizePath(p);
  const segs = n.split("/");
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join("/"));
  return out;
}

/** True when `folder` covers `other`: equality, or `other` lives under it. */
export function pathContains(folder: string, other: string): boolean {
  const f = normalizePath(folder);
  const o = normalizePath(other);
  if (f === "" || o === "") return false;
  return f === o || o.startsWith(f + "/");
}

/* ------------------------------------------------------------------ */
/* Glob matching                                                       */
/* ------------------------------------------------------------------ */

function escapeRegExp(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** Match one segment against a segment pattern ("*" and "?" only). */
function segmentMatches(pattern: string, segment: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .split(/([*?])/)
        .map((part) => (part === "*" ? "[^/]*" : part === "?" ? "[^/]" : escapeRegExp(part)))
        .join("") +
      "$",
  );
  return re.test(segment);
}

/** Recursive segment-list matcher; "**" spans zero or more segments. */
function segmentsMatch(pSegs: string[], tSegs: string[]): boolean {
  if (pSegs.length === 0) return tSegs.length === 0;
  const [head, ...rest] = pSegs;
  if (head === "**") {
    for (let i = 0; i <= tSegs.length; i++) {
      if (segmentsMatch(rest, tSegs.slice(i))) return true;
    }
    return false;
  }
  if (tSegs.length === 0) return false;
  if (!segmentMatches(head, tSegs[0]!)) return false;
  return segmentsMatch(rest, tSegs.slice(1));
}

/** Glob match on normalized paths (gitignore conventions, see header). */
export function matchesGlob(pattern: string, path: string): boolean {
  const p = normalizePath(pattern);
  const t = normalizePath(path);
  if (p === "" || t === "") return false;
  if (!p.includes("/")) return segmentMatches(p, t.split("/").pop() ?? "");
  return segmentsMatch(p.split("/"), t.split("/"));
}

/* ------------------------------------------------------------------ */
/* Overlap between footprint entries                                   */
/* ------------------------------------------------------------------ */

/** Literal prefix of a pattern, up to the first segment with a glob char. */
export function literalPrefix(pattern: string): string {
  const segs = normalizePath(pattern).split("/");
  const out: string[] = [];
  for (const s of segs) {
    if (/[*?]/.test(s)) break;
    out.push(s);
  }
  return out.join("/");
}

function literalVsPattern(litPath: string, litKind: PathKind, pattern: string): boolean {
  if (matchesGlob(pattern, litPath)) return true;
  const prefix = literalPrefix(pattern);
  if (!pattern.includes("/") || prefix === "") return true; // basename/loose: may hit anywhere
  if (litKind === "dir") {
    // The pattern may match files INSIDE the dir, or the dir contains the prefix.
    return pathContains(litPath, prefix) || pathContains(prefix, litPath);
  }
  return false;
}

/**
 * Overlap between two footprint entries (file/dir/pattern combinations).
 * Conservative for pattern×pattern: literal prefixes must be compatible.
 */
export function entriesOverlap(
  aPath: string,
  aKind: PathKind,
  bPath: string,
  bKind: PathKind,
): boolean {
  const a = normalizePath(aPath);
  const b = normalizePath(bPath);
  if (a === "" || b === "") return false;

  if (aKind === "pattern" && bKind === "pattern") {
    if (a === b) return true;
    const pa = literalPrefix(a);
    const pb = literalPrefix(b);
    if (pa === "" || pb === "") return true;
    return pathContains(pa, pb) || pathContains(pb, pa);
  }
  if (aKind === "pattern") return literalVsPattern(b, bKind, a);
  if (bKind === "pattern") return literalVsPattern(a, aKind, b);

  // file/dir combinations: equality or containment either way
  if (a === b) return true;
  if (aKind === "dir" && pathContains(a, b)) return true;
  if (bKind === "dir" && pathContains(b, a)) return true;
  return false;
}
