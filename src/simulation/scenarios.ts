/**
 * simulation/scenarios — ready-to-replay scenarios, first the "four agents"
 * story of spec §2 (video §23, judges §24.1): one pilot, four agent sessions,
 * one repo, twenty minutes of parallel work.
 */

import type { SimulationScenario } from "../core/types";

export const FOUR_AGENTS: SimulationScenario = {
  key: "four-agents",
  title: "Four agents, one repo",
  description:
    "Léa drives four agent sessions on acme/billing. Two collide on invoice.ts, " +
    "one grabs the migrations lock, another waits, notices fly, and closing " +
    "frees the neighbours — the full product story in eleven steps.",
  repos: [{ slug: "acme/billing", defaultBranch: "main" }],
  actors: [
    { ref: "a1", accountId: "lea@example.com", displayName: "Léa · agent 1", kind: "agent" },
    { ref: "a2", accountId: "lea@example.com", displayName: "Léa · agent 2", kind: "agent" },
    { ref: "a3", accountId: "lea@example.com", displayName: "Léa · agent 3", kind: "agent" },
    { ref: "a4", accountId: "lea@example.com", displayName: "Léa · agent 4", kind: "agent" },
  ],
  steps: [
    {
      actor: "a1",
      action: "declare",
      input: { issueKey: "PROJ-88", paths: "src/billing/" },
      expect: { verdict: "free" },
      note: "Agent 1 starts the invoice refactor on the whole billing folder.",
    },
    {
      actor: "a2",
      action: "declare",
      input: { issueKey: "PROJ-101", paths: "src/billing/invoice.ts" },
      expect: { verdict: "caution", degree: 2 },
      note: "Agent 2 targets invoice.ts, inside agent 1's folder: D2, neighbour named.",
    },
    {
      actor: "a3",
      action: "reserve",
      input: { issueKey: "PROJ-93", paths: "db/migrations", minutes: 120, reason: "renumbering migrations" },
      note: "Agent 3 locks the exclusive migrations resource for two hours.",
    },
    {
      actor: "a4",
      action: "declare",
      input: { issueKey: "PROJ-95", paths: "db/migrations/0042_add_index.sql" },
      expect: { verdict: "wait", degree: 4 },
      note: "Agent 4 wants a migration: D4 exclusive, told to work elsewhere.",
    },
    {
      actor: "a1",
      action: "notice",
      input: {
        issueKey: "PROJ-88",
        paths: "src/billing/invoice.ts",
        text: "renaming invoices.total to total_cents",
      },
      note: "Agent 1 warns before a rename (protocol step 4).",
    },
    {
      actor: "a2",
      action: "touch",
      input: { path: "src/billing/invoice.ts" },
      expect: { verdict: "caution" },
      note: "Agent 2's hook fires on the file: it reads the rename notice before editing.",
    },
    {
      actor: "a4",
      action: "touch",
      input: { path: "db/migrations/0043_add_index.sql" },
      expect: { verdict: "wait" },
      note: "Even a direct write attempt lands in the reserved zone: warned.",
    },
    {
      actor: "a3",
      action: "close",
      input: { issueKey: "PROJ-93" },
      note: "Agent 3 merges and closes: the reservation is released.",
    },
    {
      actor: "a4",
      action: "declare",
      input: { issueKey: "PROJ-95", paths: "db/migrations/0042_add_index.sql" },
      expect: { verdict: "free" },
      note: "Agent 4 redeclares: the way is free now (spec §8 'wait' queue).",
    },
    {
      actor: "a1",
      action: "close",
      input: { issueKey: "PROJ-88" },
      note: "Agent 1 merges the refactor.",
    },
    {
      actor: "a2",
      action: "declare",
      input: { issueKey: "PROJ-101", paths: "src/billing/invoice.ts" },
      expect: { verdict: "free" },
      note: "Agent 2 proceeds alone on invoice.ts.",
    },
  ],
};

export const SCENARIOS: SimulationScenario[] = [FOUR_AGENTS];
