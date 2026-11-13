/**
 * services/engine — the ONE way to assemble a runnable engine in memory:
 * stores + a controllable clock + a `Ctx` factory. Used by the simulation
 * console (`simulation/run`) and the browser demo (`site/demo`), so the two
 * never drift on how a context is built. In the Forge runtime the stores are
 * Forge SQL and the clock is real — see `forge-context.buildCtx`.
 *
 * A caller advances `engine.clock` between steps and asks `ctxFor(identity)`
 * for a context; every context shares the same stores and clock.
 */

import type { Identity } from "../core/types";
import { createMemoryStores } from "../storage/memory";
import { makeClock, type TestClock } from "../testing/clock";
import type { Ctx } from "./ctx";

export interface EngineOptions {
  /** Project key the contexts carry. Simulation uses "SIM", the demo "PROJ". */
  projectId?: string;
  /** ISO start time of the controllable clock (defaults to makeClock's). */
  startIso?: string;
  jira?: Ctx["jira"];
  randomHex?: Ctx["randomHex"];
  sha256?: Ctx["sha256"];
}

export interface Engine {
  stores: ReturnType<typeof createMemoryStores>;
  clock: TestClock;
  /** A service context on this engine's stores + clock, for one identity. */
  ctxFor(identity: Identity, projectId?: string): Ctx;
}

export function buildEngine(options: EngineOptions = {}): Engine {
  const stores = createMemoryStores();
  const clock = makeClock(options.startIso);
  const baseProject = options.projectId ?? "PROJ";
  return {
    stores,
    clock,
    ctxFor: (identity, projectId = baseProject) => ({
      stores,
      now: () => clock.now(),
      identity,
      projectId,
      jira: options.jira,
      randomHex: options.randomHex,
      sha256: options.sha256,
    }),
  };
}