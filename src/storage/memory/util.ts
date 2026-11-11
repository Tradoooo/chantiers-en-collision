/**
 * storage/memory/util — small helpers shared by the memory stores.
 */

/** Current time as an ISO-8601 string (the SQL stores would use NOW()). */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Normalize a repo slug: trim, drop leading/trailing slashes, keep the case
 * (the case belongs to the forge provider).
 *
 * Local copy on purpose: the storage layer must not depend on the services
 * layer (services depend on storage, not the other way round), and
 * `src/services/shared.ts` is frozen.
 */
export function normalizeSlug(slug: string): string {
  return slug.trim().replace(/^\/+|\/+$/g, "");
}
