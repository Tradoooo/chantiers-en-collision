#!/usr/bin/env node
// check-runner.mjs — the health of the self-hosted runner that runs the CI.
//
// History (2026-11-12 → 2026-11-13). Three defects bit this repo:
//   1. a zombie session  → the listener loops on "A session for this runner
//      already exists" and the runner never takes a job;
//   2. a ghost runner registered at the REPO level with the same name as the
//      healthy ORG-level one → the jobs are routed to the ghost (offline);
//   3. stale credentials after a repo transfer → the runner connects but is
//      never dispatched.
//
// The 2026-11-13 fix. The ORG-level runner `r630-chantiers-en-collision-01`
// developed a permanent zombie broker session that no restart could clear (it
// needs org-admin to re-register, which the deploy token does not have). The
// working runner is now a REPO-level one, `r630-chantiers-repo-01`, run as the
// systemd --user unit `actions-runner-chantiers-repo-01.service` (Restart=always,
// WantedBy=default.target, linger on). A repo-level runner needs no runner
// group, so it is immune to the org-level dispatch bug. Its name is deliberately
// DIFFERENT from the org runner, so it is not the "ghost" of defect #2.
//
// This script reports all of that in one place.
//
// Usage: node scripts/check-runner.mjs [--json]

import { execFileSync } from "node:child_process";

// The healthy repo-level runner (systemd user unit) and the legacy org one.
const REPO_RUNNER = "r630-chantiers-repo-01";
const ORG_RUNNER = "r630-chantiers-en-collision-01";
const ORG = "Tradoooo";
const REPO = "Tradoooo/chantiers-en-collision";
const REPO_SLUG = REPO.split("/")[1];

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

// 1. the repo-level runner exists and is online — this is the one that runs CI.
const repoRunners = gh(
  ["api", `repos/${ORG}/${REPO_SLUG}/actions/runners`, "--paginate", "--jq",
    ".runners[] | \"\\(.id) \\(.name) \\(.status) \\(.busy)\""],
  "",
);
const repoLine = repoRunners.split("\n").find((line) => line.includes(` ${REPO_RUNNER} `));
const [repoId, , repoStatus, repoBusy] = (repoLine ?? "").split(/\s+/);
info.repoRunner = { id: repoId, name: REPO_RUNNER, status: repoStatus, busy: repoBusy };
check(!!repoId, `aucun runner repo nommé ${REPO_RUNNER} (systemd --user actions-runner-chantiers-repo-01.service)`);
check(
  repoStatus === "online",
  `le runner repo ${REPO_RUNNER} est ${repoStatus || "absent"} (il doit être online)`,
);

// 2. a ghost: a repo-level runner that REUSES the org runner's name shadows it.
const ghosts = repoRunners
  .split("\n")
  .filter((line) => line.includes(` ${ORG_RUNNER} `))
  .map((line) => line.split(/\s+/).slice(0, 3).join(" "));
info.ghosts = ghosts;
check(
  ghosts.length === 0,
  `runner fantôme au niveau repo (il masque le runner org) : ${ghosts.join(" | ")} → ` +
    `gh api --method DELETE repos/${REPO}/actions/runners/<id>`,
);

// 3. the legacy org-level runner (informational — often a zombie, that is why
//    the repo-level one exists).
const orgLine = gh(
  ["api", `orgs/${ORG}/actions/runners`, "--paginate", "--jq",
    `.runners[] | select(.name=="${ORG_RUNNER}") | "\\(.status) \\(.busy)"`],
  "",
);
const [orgStatus, orgBusy] = orgLine.split(/\s+/);
info.orgRunner = { name: ORG_RUNNER, status: orgStatus, busy: orgBusy };

const git = (args, fallback = "") => {
  try {
    return execFileSync("git", args, { encoding: "utf8", timeout: 30000 }).trim();
  } catch {
    return fallback;
  }
};

// 4. the CI run of HEAD is not stuck in the queue while a runner is available.
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
const anyRunnerOnline = repoStatus === "online" || orgStatus === "online";
if (latest.status === "queued" && anyRunnerOnline) {
  problems.push(
    "le job CI est 'queued' alors qu'un runner est en ligne : dispatch GitHub bloqué " +
      "(côté plateforme) — le code reste validé par 'npm run verify' en local",
  );
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...info, problems }, null, 2));
} else {
  const busy = (b) => (b === "true" ? " (occupé)" : "");
  console.log(`runner repo ${REPO_RUNNER} : ${repoStatus || "absent"}${busy(repoBusy)}`);
  console.log(`runner org  ${ORG_RUNNER} : ${orgStatus || "absent"}${busy(orgBusy)} (héritage — souvent zombie)`);
  console.log(`runner fantôme au niveau repo : ${ghosts.length === 0 ? "aucun" : ghosts.join(" | ")}`);
  console.log(`CI sur ${head} : ${latest.status || "inconnu"}/${latest.conclusion || "en cours"}`);
}
if (problems.length > 0) {
  console.error("\ncheck-runner : PROBLÈMES");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\ncheck-runner : OK");