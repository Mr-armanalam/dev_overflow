/**
 * Tests for the AI cost table (lib/ai/pricing.ts). Pure functions
 * only — no database, no network, no provider.
 */
import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "./pricing";

describe("estimateCostUsd", () => {
  it("prices gemini-3.5-flash-lite at $0.30 / $2.50 per 1M tokens", () => {
    // 1M input + 1M output tokens.
    expect(
      estimateCostUsd("gemini-3.5-flash-lite", 1_000_000, 1_000_000)
    ).toBe(2.8);
  });

  it("prices gemini-3.8-flash at $0.75 / $3.75 per 1M tokens", () => {
    // 1M input + 1M output tokens.
    expect(estimateCostUsd("gemini-3.8-flash", 1_000_000, 1_000_000)).toBe(
      4.5
    );
  });

  it("still prices historical gemini-2.5-flash logs", () => {
    expect(estimateCostUsd("gemini-2.5-flash", 1_000_000, 1_000_000)).toBe(
      2.8
    );
  });

  it("returns 0 for an unknown model", () => {
    expect(estimateCostUsd("gemini-unknown", 1_000_000, 1_000_000)).toBe(0);
  });
});
