import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Run each package's test file in a single worker process. This keeps
    // process/memory usage predictable when many packages' test suites run
    // concurrently under turbo (e.g. in CI), which otherwise oversubscribes
    // CPU-constrained runners and can crash native addons like
    // better-sqlite3 (surfaces as "Worker exited unexpectedly").
    pool: "forks",
    forks: {
      singleFork: true,
    },
    isolate: false,
  },
});
