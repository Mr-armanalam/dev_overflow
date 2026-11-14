import { defineConfig } from "vitest/config";

/**
 * Vitest (Wave 4). Node environment, no database, no network.
 * Tests live next to the code they cover (files ending .test.ts
 * under lib/).
 * The first test proves the runner is wired:
 * `lib/ai/guardrails/input.test.ts` (pure PII/injection/spam helpers).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
