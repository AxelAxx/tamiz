import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside React Server Components; the unit tests import
      // server modules directly, so it is replaced by an empty module here.
      "server-only": resolve(import.meta.dirname, "test/support/server-only.ts"),
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
