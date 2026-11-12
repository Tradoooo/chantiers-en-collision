#!/usr/bin/env node
// check-storage.mjs — the parity guard of the two stores.
//
// The app runs on Forge SQL (src/storage/forge) and on the in-memory store
// (src/storage/memory). They MUST behave the same: the tests run against the
// memory store, the judges read the Forge one. This script checks statically
// that the shared rules really are shared, so the two cannot drift apart:
//
//  1. the source/mode ranking lives ONLY in src/core/footprints.ts;
//  2. both stores import the shared helpers instead of redefining them;
//  3. the forge store keeps firstAt (first observed) like the memory one;
//  4. the forge store preserves a recorded resolution/reason;
//  5. both stores expose the same methods;
//  6. the schema enforces the footprint key (unique index).

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const CORE_FOOTPRINTS = "src/core/footprints.ts";
const MEMORY_FOOTPRINTS = "src/storage/memory/footprints.ts";
const FORGE_FOOTPRINTS = "src/storage/forge/footprints.ts";
const FORGE_COLLISIONS = "src/storage/forge/collisions.ts";
const SCHEMA = "src/storage/schema.ts";

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const memory = read(MEMORY_FOOTPRINTS);
const forge = read(FORGE_FOOTPRINTS);
const forgeCollisions = read(FORGE_COLLISIONS);
const schema = read(SCHEMA);

// 1. the ranking table lives only in the core.
const rankDefs = [CORE_FOOTPRINTS, MEMORY_FOOTPRINTS, FORGE_FOOTPRINTS].filter((file) =>
  /SOURCE_RANK\s*:\s*Record|MODE_RANK\s*:\s*Record/.test(read(file)),
);
check(
  rankDefs.length === 1 && rankDefs[0] === CORE_FOOTPRINTS,
  `the source/mode ranking must live only in ${CORE_FOOTPRINTS} (found in: ${rankDefs.join(", ") || "nowhere"})`,
);

// 2. both stores use the shared helpers.
for (const [file, source] of [
  [MEMORY_FOOTPRINTS, memory],
  [FORGE_FOOTPRINTS, forge],
]) {
  check(
    /from "\.\.\/\.\.\/core\/footprints"/.test(source) &&
      /strongestSource/.test(source) &&
      /strongestMode/.test(source),
    `${file} must import strongestSource/strongestMode from core/footprints`,
  );
}

// 3. firstAt = first observed, in both stores.
check(
  !/firstAt:\s*stored\.firstAt\s*<=\s*at/.test(forge),
  `${FORGE_FOOTPRINTS} must keep the first observed firstAt (no min() on the timestamp)`,
);
check(
  /firstAt:\s*stored\.firstAt/.test(forge),
  `${FORGE_FOOTPRINTS} must keep firstAt = stored.firstAt`,
);

// 4. a recorded resolution is never silently cleared.
check(
  /resolution:\s*resolution\s*\?\?\s*existing\.resolution/.test(forgeCollisions),
  `${FORGE_COLLISIONS} must preserve a recorded resolution when the argument is absent`,
);
check(
  /reason:\s*reason\s*\?\?\s*existing\.reason/.test(forgeCollisions),
  `${FORGE_COLLISIONS} must preserve a recorded reason when the argument is absent`,
);
check(
  /resolution:\s*draft\.resolution\s*\?\?\s*prior\?\.resolution/.test(forgeCollisions),
  `${FORGE_COLLISIONS} must keep the resolution on re-detection`,
);

// 5. both stores expose the same methods.
const keysOf = (source) => {
  const start = source.indexOf("export function createFootprintStore");
  const body = source.slice(start, source.indexOf("};", start));
  return [...body.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((m) => m[1]).sort();
};
const memoryKeys = keysOf(memory);
const forgeKeys = keysOf(forge);
check(
  memoryKeys.length > 0 &&
    memoryKeys.join(",") === forgeKeys.join(","),
  `both footprint stores must expose the same methods (memory: ${memoryKeys.join(",")} / forge: ${forgeKeys.join(",")})`,
);

// 6. the schema indexes the footprint key.
const footprintKeyIndex = /CREATE (UNIQUE )?INDEX IF NOT EXISTS idx_footprint_worksite_path ON footprint \(worksite_id, path\)/.exec(
  schema,
);
check(
  footprintKeyIndex !== null,
  `${SCHEMA} must declare the index on footprint (worksite_id, path)`,
);
if (footprintKeyIndex !== null && footprintKeyIndex[1] === undefined) {
  console.warn(
    "check-storage: the footprint key index is not UNIQUE — the contract is enforced in the code only (live duplicate check pending)",
  );
}

if (failures.length > 0) {
  console.error("check-storage: FAILED");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("check-storage: OK — the two stores share the same rules");
