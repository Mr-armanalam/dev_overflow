/**
 * Input guardrails for the AI routes (design §8.1, P1 slice):
 * Zod validation with length caps, PII scrubbing before anything is
 * sent to the provider, and a prompt-injection screen.
 *
 * Injection inputs are FLAGGED and logged, never silently rewritten
 * (design §8.1): the call still proceeds, and the AiUsageLog row gets
 * status "flagged" so flagged attempts are visible in /admin/ai.
 */
import { z } from "zod";
import {
  AI_DRAFT_MAX_CONTENT_CHARS,
  AI_TAG_SUGGEST_MAX_BODY_CHARS,
  AI_TAG_SUGGEST_MAX_TITLE_CHARS,
} from "../limits";

/** The draft route takes only a question id — title/content are loaded
 *  from the database, never trusted from the client. */
export const AiDraftInputSchema = z.object({
  questionId: z.string().min(1),
});

export const AiTagSuggestInputSchema = z.object({
  title: z.string().min(1).max(AI_TAG_SUGGEST_MAX_TITLE_CHARS),
  body: z.string().min(1).max(AI_TAG_SUGGEST_MAX_BODY_CHARS),
});

/** Input for POST /api/ai/similar (RAG, P2): title is required, body
 *  optional, excludeQuestionId skips the question being edited. */
export const AiSimilarInputSchema = z.object({
  title: z.string().min(1).max(AI_TAG_SUGGEST_MAX_TITLE_CHARS),
  body: z.string().max(AI_TAG_SUGGEST_MAX_BODY_CHARS).optional(),
  excludeQuestionId: z.string().min(1).optional(),
});

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses
  {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "[email removed]",
  },
  // Phone numbers (international / NANP-ish, 7+ digits with separators)
  {
    pattern: /\+?\d[\d\s().-]{6,}\d/g,
    replacement: "[phone removed]",
  },
  // API keys / tokens: sk-…, sk-proj-…, AKIA…, ghp_/gho_/ghu_/ghs_/ghr_…,
  // github_pat_…, xox[baprs]-…, npm_…, generic 32+ char hex-ish secrets
  {
    pattern: /\b(sk-proj-[A-Za-z0-9_-]+|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|ghr_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{20,})\b/g,
    replacement: "[secret removed]",
  },
];

/** Remove emails, phone numbers and key/token-looking strings. */
export function scrubPII(text: string): string {
  let scrubbed = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}

/** Phrases that indicate an attempt to override the system prompt. */
const INJECTION_PHRASES = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "ignore your instructions",
  "disregard all prior instructions",
  "disregard previous instructions",
  "you are now",
  "system prompt",
  "reveal your instructions",
  "new instructions:",
  "jailbreak",
  "developer mode",
  "do anything now",
];

export function detectPromptInjection(text: string): boolean {
  const lower = text.toLowerCase();
  return INJECTION_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * Best-effort HTML → plain text for TinyMCE question bodies before
 * they go into a prompt. Tag stripping by regex is lossy by design —
 * prompts only need the words, not the markup.
 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export { AI_DRAFT_MAX_CONTENT_CHARS };
