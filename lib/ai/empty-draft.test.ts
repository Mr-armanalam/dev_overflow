/**
 * Tests for the empty-draft helpers (root-cause PR). Pure functions
 * only — no database, no network, no provider.
 */
import { describe, expect, it } from "vitest";
import {
  emptyDraftErrorCode,
  emptyDraftMessage,
  isSafetyEmptyDraft,
  isUsableCachedDraft,
  modelCheckExitCode,
} from "./empty-draft";
import type { CachedDraft } from "./cache";

function draft(text: string): CachedDraft {
  return {
    text,
    sources: [],
    modelName: "gemini-2.5-flash",
    promptId: "answer-draft",
    promptVersion: 3,
  };
}

describe("emptyDraftErrorCode", () => {
  it("upper-cases the AI SDK finish reason", () => {
    expect(emptyDraftErrorCode("content-filter")).toBe(
      "EMPTY_RESPONSE_CONTENT-FILTER"
    );
    expect(emptyDraftErrorCode("stop")).toBe("EMPTY_RESPONSE_STOP");
  });

  it("falls back to UNKNOWN for a blank reason", () => {
    expect(emptyDraftErrorCode("")).toBe("EMPTY_RESPONSE_UNKNOWN");
    expect(emptyDraftErrorCode("   ")).toBe("EMPTY_RESPONSE_UNKNOWN");
  });
});

describe("isSafetyEmptyDraft", () => {
  it("is true only for the content-filter code", () => {
    expect(isSafetyEmptyDraft("EMPTY_RESPONSE_CONTENT-FILTER")).toBe(true);
    expect(isSafetyEmptyDraft("EMPTY_RESPONSE_STOP")).toBe(false);
    expect(isSafetyEmptyDraft("EMPTY_RESPONSE")).toBe(false);
    expect(isSafetyEmptyDraft(null)).toBe(false);
    expect(isSafetyEmptyDraft(undefined)).toBe(false);
  });
});

describe("emptyDraftMessage", () => {
  it("tells the user to rephrase on a safety block", () => {
    expect(emptyDraftMessage("EMPTY_RESPONSE_CONTENT-FILTER")).toBe(
      "The AI declined to answer this question — try rephrasing it."
    );
  });

  it("falls back to the generic message otherwise", () => {
    expect(emptyDraftMessage("EMPTY_RESPONSE_STOP")).toBe(
      "The AI returned an empty draft. Please try regenerating."
    );
    expect(emptyDraftMessage(null)).toBe(
      "The AI returned an empty draft. Please try regenerating."
    );
  });
});

describe("isUsableCachedDraft", () => {
  it("rejects null and undefined", () => {
    expect(isUsableCachedDraft(null)).toBe(false);
    expect(isUsableCachedDraft(undefined)).toBe(false);
  });

  it("rejects empty and whitespace-only text (poisoned entries)", () => {
    expect(isUsableCachedDraft(draft(""))).toBe(false);
    expect(isUsableCachedDraft(draft("   \n  "))).toBe(false);
  });

  it("accepts a draft with real text", () => {
    expect(isUsableCachedDraft(draft("Use sort() — it sorts in place."))).toBe(
      true
    );
  });
});

describe("modelCheckExitCode", () => {
  it("is 0 when any model returns non-empty text", () => {
    expect(
      modelCheckExitCode([
        { nonEmpty: false, errored: true },
        { nonEmpty: true, errored: false },
      ])
    ).toBe(0);
  });

  it("is 1 when both answer cleanly but empty", () => {
    expect(
      modelCheckExitCode([
        { nonEmpty: false, errored: false },
        { nonEmpty: false, errored: false },
      ])
    ).toBe(1);
  });

  it("is 1 for a mixed empty + errored pair", () => {
    expect(
      modelCheckExitCode([
        { nonEmpty: false, errored: false },
        { nonEmpty: false, errored: true },
      ])
    ).toBe(1);
  });

  it("is 2 when both models error", () => {
    expect(
      modelCheckExitCode([
        { nonEmpty: false, errored: true },
        { nonEmpty: false, errored: true },
      ])
    ).toBe(2);
  });

  it("is 2 when nothing was probed", () => {
    expect(modelCheckExitCode([])).toBe(2);
  });
});
