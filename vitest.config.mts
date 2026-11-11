import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 30 s per test: the suite finishes in ~30 s total; this only absorbs
    // CPU contention on the shared self-hosted runners (r630), where a
    // 15 s default produced a flake. The CI job budget (5 min) is unchanged.
    testTimeout: 30000,
  },
});
