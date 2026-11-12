#!/usr/bin/env node
// verify.mjs — THE gate of the repository: one list of controls.
//
//   node scripts/verify.mjs              → every local step, in order
//   node scripts/verify.mjs --only lint  → one step (the CI jobs call it)
//   node scripts/verify.mjs --live       → the local steps + the live proofs
//
// The CI, the local dev loop, the site deploy and the proof run all go
// through THIS file: the list of controls lives here and nowhere else.

import { spawnSync } from "node:child_process";

const STEPS = [
  { name: "lint", cmd: "npm", args: ["run", "lint"] },
  { name: "typecheck", cmd: "npm", args: ["run", "typecheck"] },
  { name: "check:manifest", cmd: "npm", args: ["run", "check:manifest"] },
  { name: "check:storage", cmd: "node", args: ["scripts/check-storage.mjs"] },
  { name: "test", cmd: "npm", args: ["run", "test"] },
  { name: "check:site", cmd: "npm", args: ["run", "check:site"] },
];

/** The live proofs: the real deployment, not a simulation. */
const LIVE_STEP = {
  name: "live-proofs",
  cmd: "python3",
  args: ["scripts/prove.py"],
};

function parseArgs(argv) {
  const only = [];
  let live = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--only") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--only needs a step name");
      only.push(value);
      i += 1;
    } else if (argv[i] === "--live") {
      live = true;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { only, live };
}

function selectSteps({ only, live }) {
  const chosen = only.length > 0 ? STEPS.filter((s) => only.includes(s.name)) : STEPS;
  const unknown = only.filter((name) => !STEPS.some((s) => s.name === name));
  if (unknown.length > 0) throw new Error(`unknown step(s): ${unknown.join(", ")}`);
  return live ? [...chosen, LIVE_STEP] : chosen;
}

function run(step) {
  const started = Date.now();
  process.stdout.write(`\n==> ${step.name}\n`);
  const result = spawnSync(step.cmd, step.args, { stdio: "inherit" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) {
    process.stdout.write(`\nFAILED at ${step.name} (${seconds}s)\n`);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(`   ${step.name} OK (${seconds}s)\n`);
}

function main() {
  const steps = selectSteps(parseArgs(process.argv.slice(2)));
  for (const step of steps) run(step);
  process.stdout.write(`\nALL GREEN — ${steps.map((s) => s.name).join(" · ")}\n`);
}

main();
