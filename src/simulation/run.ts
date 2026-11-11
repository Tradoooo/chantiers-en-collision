/**
 * simulation/run — replays a scenario against in-memory stores (CC-15).
 * Owner: workstream M. Replace the stub; keep the signature EXACTLY.
 *
 * Builds a Ctx on createMemoryStores() with a controllable clock
 * (src/testing/clock.makeClock) and one identity per scenario actor, then
 * executes each step through the REAL services (declare/touch/reserve/
 * notice/close/ci). Compares the obtained verdict with step.expect and
 * collects SimulationStepResult[]. No repository, no Jira, no network.
 */

import type { SimulationResult, SimulationScenario } from "../core/types";

export async function runScenario(_scenario: SimulationScenario): Promise<SimulationResult> {
  throw new Error("TODO(simulation): not implemented — see docs/CONTRACTS.md");
}
