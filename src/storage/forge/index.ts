/**
 * storage/forge — Forge SQL implementation of every store.
 * Owner: workstream E. Replace the stub; keep the signature EXACTLY.
 *
 * This is the ONLY place (with schema.ts) allowed to import "@forge/api".
 * Split helpers across files under storage/forge/ to stay under 500 lines
 * per file; index.ts re-assembles the Stores bundle.
 * Row mapping: snake_case columns → camelCase domain types (core/types).
 */

import type { Stores } from "../interfaces";

export function createForgeStores(): Stores {
  throw new Error("TODO(forge-stores): not implemented — see docs/CONTRACTS.md");
}
