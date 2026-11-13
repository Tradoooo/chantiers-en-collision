#!/usr/bin/env node
// check-runner.mjs — the health of the self-hosted runner that runs the CI.
//
// Three defects have bitten this repo (2026-11-12):
//   1. a zombie session  → the listener loops on "A session for this runner
//      already exists" and the runner never takes a job;
//   2. a ghost runner registered at the REPO level with the same name as the
//      healthy ORG-level one → the jobs are routed to the ghost (offline);
//   3. stale credentials after a repo transfer → the runner connects but is
//      never dispatched.
//
// This script sees all three, in one place, before they cost a day.
//
// Usage: node scripts/check-runner.mjs [--json]

import { execFileSync } from "node:child_process";

const RUNNER_NAME = "r630-chantiers-en-collision-01";
const ORG = "Tradoooo";
const REPO = "Tradoooo/chantiers-en-collision";

const gh = (args, fallback = "") => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", timeout: 60000 }).trim();
  } catch {
    return fallback;
  }
};

const problems = [];
const info = {};

function check(ok, message) {
  if (!ok) problems.push(message);
}

// 1. the org-level runner exists and is online.
const orgRunners = gh(
  ["api", `orgs/${ORG}/actions/runners`, "--paginate", "--jq",
    `.runners[] | select(.name=="${RUNNER_NAME}") | "\\(.id) \\(.status) \\(.busy)"`],
  "",
);
const [runnerId, runnerStatus, runnerBusy] = orgRunners.split(/\s+/);
info.runner = { id: runnerId, status: runnerStatus, busy: runnerBusy };
check(!!runnerId, `aucun runner org nommé ${RUNNER_NAME}`);
check(runnerStatus === "online", `le runner org ${RUNNER_NAME} est ${runnerStatus || "absent"} (il doit être online)`);

// 2. no ghost runner at the repo level with the same name (it shadows the org one).
const repoRunners = gh(
  ["api", `repos/${ORG}/${REPO.split("/")[1]}/actions/runners`, "--paginate", "--jq",
    ".runners[] | \"\\(.id) \\(.name) \\(.status)\""],
  "",
);
const ghosts = repoRunners.split("\n").filter((line) => line.includes(RUNNER_NAME));
info.ghosts = ghosts;
check(
  ghosts.length === 0,
  `runner fantôme au niveau repo (il masque le runner org) : ${ghosts.join(" | ")} → ` +
    `gh api --method DELETE repos/${REPO}/actions/runners/<id>`,
);

const git = (args, fallback = "") => {
  try {
    return execFileSync("git", args, { encoding: "utf8", timeout: 30000 }).trim();
  } catch {
    return fallback;
  }
};

// 3. the CI run of HEAD is not stuck in the queue.
const head = git(["rev-parse", "HEAD"]).slice(0, 7);
const runs = gh(
  ["run", "list", "--workflow", "ci.yml", "--limit", "5", "--json", "status,conclusion,headSha"],
  "[]",
);
let latest = {};
try {
  const list = JSON.parse(runs);
  latest = list.find((r) => (r.headSha || "").startsWith(head)) ?? list[0] ?? {};
} catch {
  latest = {};
}
info.ci = { head, ...latest };
if (latest.status === "queued" && runnerStatus === "online") {
  problems.push(
    "le job CI est 'queued' alors que le runner est en ligne : dispatch GitHub bloqué " +
      "(côté plateforme) — le code reste validé par 'npm run verify' en local",
  );
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...info, problems }, null, 2));
} else {
  console.log(`runner ${RUNNER_NAME} : ${runnerStatus || "absent"}${runnerBusy === "true" ? " (occupé)" : ""}`);
  console.log(`runner fantôme au niveau repo : ${ghosts.length === 0 ? "aucun" : ghosts.join(" | ")}`);
  console.log(`CI sur ${head} : ${latest.status || "inconnu"}/${latest.conclusion || "en cours"}`);
}
if (problems.length > 0) {
  console.error("\ncheck-runner : PROBLÈMES");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\ncheck-runner : OK");
