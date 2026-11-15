/**
 * Tests for the cache delete helpers. No Redis is configured in the
 * test environment, so these prove the graceful-degradation contract:
 * deleting without a client is a no-op that never throws.
 */
import { describe, expect, it } from "vitest";
import {
  deleteCachedDraftByQuestion,
  deleteExactCache,
} from "./cache";

describe("deleteExactCache", () => {
  it("resolves without throwing when no Redis client is configured", async () => {
    await expect(
      deleteExactCache("ai:cache:exact:does-not-exist")
    ).resolves.toBeUndefined();
  });
});

describe("deleteCachedDraftByQuestion", () => {
  it("resolves without throwing when no Redis client is configured", async () => {
    await expect(
      deleteCachedDraftByQuestion("000000000000000000000000")
    ).resolves.toBeUndefined();
  });
});
