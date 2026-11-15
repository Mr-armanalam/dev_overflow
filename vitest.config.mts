import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest (Wave 4). Node environment, no database, no network.
 * Tests live next to the code they cover (files ending .test.ts
 * under lib/).
 * The first test proves the runner is wired:
 * `lib/ai/guardrails/input.test.ts` (pure PII/injection/spam helpers).
 *
 * The `@/` alias mirrors tsconfig.json: without it, no test can
 * import a module that itself imports `@/...` (i.e. almost every
 * lib module). Added with the v3 validation tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
