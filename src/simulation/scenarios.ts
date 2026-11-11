/**
 * simulation/scenarios — ready-to-replay scenarios, first the "four agents"
 * one of spec §2/§22.13 and the video §23.
 * Owner: workstream M. Replace the stubs; keep names EXACTLY.
 *
 * FOUR_AGENTS: one pilot, four agent sessions, repo acme/billing.
 *  - agent 1 declares src/billing/ (PROJ-88)
 *  - agent 2 touches src/billing/invoice.ts (PROJ-101) → caution D2, agent 1 named
 *  - agent 3 declares db/migrations/0042_x.sql (PROJ-93) while agent 4
 *    reserved migrations → wait D4 exclusive
 *  - agent 4 posts a notice ("renaming invoices.total to total_cents")
 *  - delivered ONCE to agent 2 at its next call
 *  - close PROJ-88 → agent 2's next check answers free
 */

import type { SimulationScenario } from "../core/types";

export const FOUR_AGENTS: SimulationScenario = {
  key: "four-agents",
  title: "Four agents, one repo",
  description: "One pilot drives four agent sessions on acme/billing.",
  repos: [{ slug: "acme/billing" }],
  actors: [], // TODO(simulation): fill
  steps: [], // TODO(simulation): fill per the comment above
};

export const SCENARIOS: SimulationScenario[] = [FOUR_AGENTS];
