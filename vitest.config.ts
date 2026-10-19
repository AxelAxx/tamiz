import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration (spec 001 FR-026, research R-02): one process discovers every
 * workspace package as a project and prints a single coverage table.
 *
 * `pnpm test` runs this; `pnpm test:packages` keeps the cached per-package Turborepo run.
 * Each package still owns its `vitest.config.ts` (include patterns, typecheck); only
 * coverage is configured here, because Vitest collects it once for all projects.
 */
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
