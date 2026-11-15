/**
 * Tests for the answer-grounding retrieval helpers (v3).
 * Covers `formatRetrievedAnswer` — the pure function that turns a
 * stored answer's HTML into the plain-text, PII-scrubbed, truncated
 * snippet that goes into the draft and validation prompts. No
 * database, no network: the module's other imports (models, router)
 * are import-time safe.
 */
import { describe, expect, it } from "vitest";
import {
  formatRetrievedAnswer,
  RAG_ANSWER_SNIPPET_CHARS,
} from "./retrieve";

describe("formatRetrievedAnswer", () => {
  it("strips HTML tags to plain text", () => {
    expect(
      formatRetrievedAnswer("<p>Hello <b>world</b></p><pre>const x = 1;</pre>")
    ).toBe("Hello world const x = 1;");
  });

  it("decodes common HTML entities", () => {
    expect(formatRetrievedAnswer("a &amp; b &lt;tag&gt;")).toBe("a & b <tag>");
  });

  it("scrubs PII the same way question excerpts are scrubbed", () => {
    expect(formatRetrievedAnswer("Email me at arman@example.com")).toBe(
      "Email me at [email removed]"
    );
  });

  it("leaves short clean text untouched", () => {
    const text = "Use Array.prototype.map to transform each element.";
    expect(formatRetrievedAnswer(text)).toBe(text);
  });

  it("truncates long answers to ~800 chars with an ellipsis", () => {
    const long = "a".repeat(900);
    const formatted = formatRetrievedAnswer(long);
    expect(formatted.length).toBe(RAG_ANSWER_SNIPPET_CHARS + 1);
    expect(formatted.endsWith("…")).toBe(true);
  });

  it("does not truncate text exactly at the limit", () => {
    const exact = "a".repeat(RAG_ANSWER_SNIPPET_CHARS);
    expect(formatRetrievedAnswer(exact)).toBe(exact);
  });
});
