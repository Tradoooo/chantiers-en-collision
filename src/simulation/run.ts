/**
 * simulation/run — replays a scenario against in-memory stores (CC-15).
 * No repository, no Jira, no network: the judges can replay the "four
 * agents" story from the simulation console alone (spec §24.1).
 */

import type {
  Identity,
  SimulationResult,
  SimulationScenario,
  SimulationStep,
  SimulationStepResult,
  Verdict,
  VerdictKind,
} from "../core/types";
import type { Ctx } from "../services/ctx";
import { declareFootprint } from "../services/declare";
import { closeWorksite } from "../services/worksites";
import { reserveZone } from "../services/reservations";
import { postNotice } from "../services/notices";
import { ciFootprint, hookOpen, hookTouch } from "../services/ingest";
import { buildEngine } from "../services/engine";

function str(input: Record<string, string | number | boolean>, key: string): string {
  const v = input[key];
  return v === undefined ? "" : String(v);
}

function identityFor(scenario: SimulationScenario, step: SimulationStep): Identity {
  const actor = scenario.actors.find((a) => a.ref === step.actor);
  return {
    accountId: actor?.accountId ?? `${step.actor}@simulation.local`,
    kind: actor?.kind ?? "agent",
    client: actor?.client ?? "claude-code",
    sessionRef: step.actor,
  };
}

/** Touch/open steps answer through the hook contract, not a Verdict. */
function hookExpectation(
  detail: string | undefined,
  expected: VerdictKind | undefined,
): boolean {
  if (expected === undefined) return true;
  if (expected === "free") return detail === undefined || detail === "";
  return detail !== undefined && detail !== "";
}

type StepOutcome = { verdict?: Verdict; detail?: string };

async function stepDeclare(
  ctx: Ctx,
  input: Record<string, string | number | boolean>,
  repoSlug: string,
  session: string,
): Promise<StepOutcome> {
  return {
    verdict: await declareFootprint(ctx, {
      issueKey: str(input, "issueKey"),
      repoSlug,
      paths: str(input, "paths"),
      session,
    }),
  };
}

async function stepTouch(
  ctx: Ctx,
  input: Record<string, string | number | boolean>,
  repoSlug: string,
  session: string,
): Promise<StepOutcome> {
  const resp = await hookTouch(ctx, {
    sessionRef: session,
    path: str(input, "path"),
    cwd: str(input, "cwd") || undefined,
    repoSlug,
  });
  return { detail: resp.deny ? `denied: ${resp.deny.reason}` : resp.additionalContext };
}

async function stepReserve(
  ctx: Ctx,
  input: Record<string, string | number | boolean>,
  repoSlug: string,
): Promise<StepOutcome> {
  const res = await reserveZone(ctx, {
    issueKey: str(input, "issueKey"),
    repoSlug,
    paths: str(input, "paths"),
    minutes: input["minutes"] === undefined ? undefined : Number(input["minutes"]),
    reason: str(input, "reason") || undefined,
  });
  if ("refused" in res) {
    return { detail: `refused: ${res.reason}` };
  }
  return { detail: `reserved until ${res.expiresAt}` };
}

async function stepMisc(
  ctx: Ctx,
  scenario: SimulationScenario,
  step: SimulationStep,
  repoSlug: string,
  session: string,
): Promise<StepOutcome> {
  const input = step.input;
  if (step.action === "open") {
    const opened = await hookOpen(ctx, {
      sessionRef: session,
      branch: str(input, "branch"),
      repoSlug,
    });
    return { detail: opened.response.additionalContext };
  }
  if (step.action === "close") {
    const res = await closeWorksite(ctx, { issueKey: str(input, "issueKey"), session });
    return { detail: `closed ${res.closed.length}, released ${res.released.length}` };
  }
  if (step.action === "notice") {
    const res = await postNotice(ctx, {
      issueKey: str(input, "issueKey"),
      repoSlug,
      paths: str(input, "paths"),
      text: str(input, "text"),
    });
    return { detail: `notice sent to ${res.recipients.length} neighbour(s)` };
  }
  const res = await ciFootprint(ctx, {
    repoSlug,
    branch: str(input, "branch"),
    files: str(input, "files").split("\n"),
  });
  return { detail: `ci attested ${res.entries} file(s)` };
}

async function runStep(
  ctx: Ctx,
  scenario: SimulationScenario,
  step: SimulationStep,
): Promise<StepOutcome> {
  const input = step.input;
  const repoSlug = str(input, "repo") || scenario.repos[0]?.slug || "sim/repo";
  const session = step.actor;
  switch (step.action) {
    case "declare":
      return stepDeclare(ctx, input, repoSlug, session);
    case "touch":
      return stepTouch(ctx, input, repoSlug, session);
    case "reserve":
      return stepReserve(ctx, input, repoSlug);
    default:
      return stepMisc(ctx, scenario, step, repoSlug, session);
  }
}

function checkExpectation(
  step: SimulationStep,
  verdict: Verdict | undefined,
  detail: string | undefined,
): { ok: boolean; problem?: string } {
  const expect = step.expect;
  if (!expect) return { ok: true };
  if (expect.verdict !== undefined) {
    if (verdict) {
      if (verdict.kind !== expect.verdict) {
        return { ok: false, problem: `expected verdict ${expect.verdict}, got ${verdict.kind}` };
      }
    } else if (!hookExpectation(detail, expect.verdict)) {
      return {
        ok: false,
        problem: `expected a ${expect.verdict} warning, the hook answered nothing`,
      };
    }
  }
  if (expect.degree !== undefined && verdict) {
    const worst = verdict.collisions.reduce((m, c) => Math.max(m, c.degree), 0);
    if (verdict.collisions.length > 0 && worst !== expect.degree) {
      return { ok: false, problem: `expected degree D${expect.degree}, got D${worst}` };
    }
  }
  return { ok: true };
}

export async function runScenario(scenario: SimulationScenario): Promise<SimulationResult> {
  const engine = buildEngine({ projectId: "SIM" });
  const results: SimulationStepResult[] = [];
  let index = 0;

  for (const step of scenario.steps) {
    index += 1;
    engine.clock.advance(2); // a couple of minutes between steps, for realism
    const ctx: Ctx = engine.ctxFor(identityFor(scenario, step));
    const result: SimulationStepResult = { index, step, ok: true };
    try {
      const outcome = await runStep(ctx, scenario, step);
      result.verdict = outcome.verdict;
      result.detail =
        outcome.verdict !== undefined
          ? outcome.verdict.text.slice(0, 300)
          : (outcome.detail ?? "");
      const checked = checkExpectation(step, outcome.verdict, outcome.detail);
      result.ok = checked.ok;
      if (!checked.ok) result.detail = `${checked.problem} — ${result.detail ?? ""}`;
    } catch (e) {
      result.ok = false;
      result.detail = `error: ${(e as Error).message}`;
    }
    results.push(result);
  }
  return { scenarioKey: scenario.key, results, allOk: results.every((r) => r.ok) };
}
