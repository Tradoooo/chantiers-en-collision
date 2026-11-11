/**
 * storage/memory/clone — defensive copies of the stored objects.
 *
 * The stores never hand out a reference to their internal state: every
 * returned object is a deep copy, so a caller mutating a result can never
 * corrupt the in-memory database (and vice-versa).
 *
 * Plain data only: strings, numbers, booleans, arrays and plain objects.
 * `undefined` values are preserved (unlike JSON round-trips).
 */

export function clone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = clone(item);
  }
  return out as T;
}
