import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same reasoning as the sibling devops-knowledge-mcp project's
    // vitest.config.ts: the DB-touching tests (tests/db, tests/lib) share
    // one real Postgres and truncate between tests, which races under
    // Vitest's default per-file parallelism.
    fileParallelism: false,
  },
});
