import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 30 s per test: the suite finishes in ~30 s total; this only absorbs
    // CPU contention on the shared self-hosted runners (r630), where a
    // 15 s default produced a flake. The CI job budget (5 min) is unchanged.
    testTimeout: 30000,
    // r630 is shared (100+ runners, k3s, agents): cap the fork pool so the
    // vitest workers never exhaust the machine ("Failed to start forks
    // worker" flakes). 2 forks still run the suite in ~40 s.
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 },
    },
  },
});
