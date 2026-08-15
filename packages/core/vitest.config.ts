import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: {
      deps: {
        external: [/better-sqlite3/],
      },
    },
    include: ["src/**/*.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
    fileParallelism: false
  }
});
