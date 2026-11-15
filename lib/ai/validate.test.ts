/**
 * Tests for draft self-validation (v3). Covers the validation Zod
 * schema, the reviewer prompt builder, and the pure merge of a
 * validation result into the draft the user sees. No database, no
 * network, no provider: the module's other imports (models, router,
 * cache) are import-time safe.
 */
import { describe, expect, it } from "vitest";
import {
  buildValidationPrompt,
  unavailableValidationResult,
  ValidationResultSchema,
} from "./validate";
import {
  applyValidationResult,
  groundednessLabel,
} from "./validation-result";

describe("ValidationResultSchema", () => {
  it("accepts a valid ok verdict with no issues", () => {
    expect(
      ValidationResultSchema.parse({
        verdict: "ok",
        groundedness: "grounded",
        issues: [],
        revisedDraft: null,
      })
    ).toEqual({
      verdict: "ok",
      groundedness: "grounded",
      issues: [],
      revisedDraft: null,
    });
  });

  it("accepts a needs-revision verdict with issues and a revised draft", () => {
    const parsed = ValidationResultSchema.parse({
      verdict: "needs-revision",
      groundedness: "partial",
      issues: [
        {
          claim: "The draft says sort() mutates the original array.",
          problem: "The cited answer [1] says the opposite.",
          fix: "State that sort() sorts in place.",
        },
      ],
      revisedDraft: "## Answer\nUse sort() — it sorts in place [1].",
    });
    expect(parsed.verdict).toBe("needs-revision");
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.revisedDraft).toContain("sorts in place");
  });

  it("accepts an unverifiable verdict for pure general knowledge", () => {
    const parsed = ValidationResultSchema.parse({
      verdict: "unverifiable",
      groundedness: "general-knowledge",
      issues: [],
      revisedDraft: null,
    });
    expect(parsed.verdict).toBe("unverifiable");
  });

  it("rejects an unknown verdict", () => {
    expect(() =>
      ValidationResultSchema.parse({
        verdict: "great",
        groundedness: "grounded",
        issues: [],
        revisedDraft: null,
      })
    ).toThrow();
  });

  it("rejects an issue missing the fix field", () => {
    expect(() =>
      ValidationResultSchema.parse({
        verdict: "needs-revision",
        groundedness: "partial",
        issues: [{ claim: "Wrong claim", problem: "No source says this" }],
        revisedDraft: "Fixed draft.",
      })
    ).toThrow();
  });

  it("rejects a non-string revisedDraft", () => {
    expect(() =>
      ValidationResultSchema.parse({
        verdict: "ok",
        groundedness: "grounded",
        issues: [],
        revisedDraft: 123,
      })
    ).toThrow();
  });
});

describe("buildValidationPrompt", () => {
  it("includes the question, the draft, and the grounding answers", () => {
    const prompt = buildValidationPrompt({
      title: "How do I sort an array?",
      content: "I need to sort numbers in JavaScript.",
      draft: "Use sort() [1].",
      sources: [
        {
          questionId: "q1",
          title: "Sorting arrays in JS",
          snippet: "How to sort an array of numbers?",
          score: 0.9,
          cosine: 0.95,
          upvotes: 5,
          createdAt: new Date(),
          answers: [
            {
              answerId: "a1",
              content: "Use sort((a, b) => a - b) for numbers.",
              upvotes: 12,
            },
          ],
        },
      ],
    });
    expect(prompt).toContain("How do I sort an array?");
    expect(prompt).toContain("Use sort() [1].");
    expect(prompt).toContain("Sorting arrays in JS");
    expect(prompt).toContain("(12 upvotes) Use sort((a, b) => a - b)");
  });

  it("says there are no sources when retrieval found nothing", () => {
    const prompt = buildValidationPrompt({
      title: "Obscure question",
      content: "Something no one asked before.",
      draft: "A guess from general knowledge.",
      sources: [],
    });
    expect(prompt).toContain("Retrieved sources: none.");
  });
});

describe("applyValidationResult", () => {
  it("replaces the original with a revised draft and notes the fix count", () => {
    const merged = applyValidationResult("Original draft.", {
      revisedDraft: "Revised draft.",
      groundedness: "grounded",
      issuesFixed: 2,
    });
    expect(merged.markdown).toBe("Revised draft.");
    expect(merged.note).toBe(
      "Self-check refined this draft — 2 issues fixed."
    );
    expect(merged.groundedness).toBe("grounded");
  });

  it("uses the singular form for one fixed issue", () => {
    const merged = applyValidationResult("Original draft.", {
      revisedDraft: "Revised draft.",
      groundedness: "partial",
      issuesFixed: 1,
    });
    expect(merged.note).toBe(
      "Self-check refined this draft — 1 issue fixed."
    );
  });

  it("keeps the original when validation is unavailable", () => {
    const merged = applyValidationResult("Original draft.", {
      revisedDraft: null,
      groundedness: "general-knowledge",
      issuesFixed: 0,
    });
    expect(merged.markdown).toBe("Original draft.");
    expect(merged.note).toBeNull();
  });

  it("keeps the original when the revised draft is whitespace-only", () => {
    const merged = applyValidationResult("Original draft.", {
      revisedDraft: "   ",
      groundedness: "grounded",
      issuesFixed: 3,
    });
    expect(merged.markdown).toBe("Original draft.");
    expect(merged.note).toBeNull();
  });
});

describe("groundednessLabel", () => {
  it("labels each grounding state", () => {
    expect(groundednessLabel("grounded")).toBe(
      "Grounded in community answers"
    );
    expect(groundednessLabel("partial")).toBe(
      "Partly grounded in community answers"
    );
    expect(groundednessLabel("general-knowledge")).toBe(
      "General knowledge — no matching community answers"
    );
  });
});

describe("unavailableValidationResult", () => {
  it("returns the never-breaks-the-draft fallback", () => {
    expect(unavailableValidationResult()).toEqual({
      verdict: "unavailable",
      groundedness: "general-knowledge",
      issues: [],
      revisedDraft: null,
      sources: [],
    });
  });
});
