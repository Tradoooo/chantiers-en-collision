#!/usr/bin/env node
/**
 * check-site-bundle.mjs — CI gate for the GitHub Pages demo.
 *
 * Loads the esbuild bundle (site/dist/demo.js) in a bare VM context with a
 * minimal `document` stub, then exercises the REAL engine headlessly:
 *  1. the "four agents" scenario must replay with allOk = true;
 *  2. the playground must return the spec's verdicts (migrations → wait D4,
 *     folder vs file → caution D2, auth vs billing → free).
 * Any mismatch exits non-zero: what the judges click is what the tests run.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const file = new URL("../site/dist/demo.js", import.meta.url);
const code = readFileSync(file, "utf8");

const sandbox = {
  console,
  document: { readyState: "loading", addEventListener() {} },
};
vm.createContext(sandbox);
vm.runInNewContext(code, sandbox);

const api = sandbox.Chantiers;
if (!api || typeof api.fourAgents !== "function" || typeof api.playground !== "function") {
  console.error("demo.js does not expose Chantiers.fourAgents / Chantiers.playground");
  process.exit(1);
}

const fail = (msg) => {
  console.error(`site bundle check FAILED: ${msg}`);
  process.exit(1);
};

const scenario = await api.fourAgents();
if (!scenario.allOk) {
  const bad = scenario.results.filter((r) => !r.ok).map((r) => `${r.index}:${r.detail}`);
  fail(`four-agents scenario: ${bad.join(" | ")}`);
}

const migrations = await api.playground(
  "db/migrations/0042_total_cents.sql",
  "db/migrations/0043_index.sql",
);
if (migrations.b.kind !== "wait" || migrations.b.collisions[0]?.degree !== 4) {
  fail(`migrations playground: expected wait D4, got ${migrations.b.kind} D${migrations.b.collisions[0]?.degree}`);
}

const folder = await api.playground("src/billing/", "src/billing/invoice.ts");
if (folder.b.kind !== "caution" || folder.b.collisions[0]?.degree !== 2) {
  fail(`folder playground: expected caution D2, got ${folder.b.kind} D${folder.b.collisions[0]?.degree}`);
}

const clear = await api.playground("src/billing/invoice.ts", "src/auth/login.ts");
if (clear.b.kind !== "free" || clear.b.collisions.length !== 0) {
  fail(`clear playground: expected free, got ${clear.b.kind}`);
}

// The shared demo world must seed headlessly (map/panel/planning/ops sections
// all render from it): repo, four-plus open worksites, one reservation,
// one pending notice, merged history for prediction.
if (typeof api.createWorld !== "function") fail("createWorld is not exported by the bundle");
const world = api.createWorld();
await world.seed();
const open = await world.stores.worksites.listOpenByRepo(world.repoId());
if (open.length < 4) fail(`seeded world: expected >= 4 open worksites, got ${open.length}`);
const active = await world.stores.reservations.listActive(world.repoId(), world.clock.now());
if (active.length !== 1) fail(`seeded world: expected 1 active reservation, got ${active.length}`);
const history = await world.jira.mergedHistory("acme/billing");
if (!Array.isArray(history) || history.length === 0) fail("seeded world: merged history is empty");

console.log(
  `site bundle OK — scenario ${scenario.results.length}/${scenario.results.length} steps, ` +
    `playground verdicts wait-D4 / caution-D2 / free, world seeded (${open.length} worksites)`,
);
