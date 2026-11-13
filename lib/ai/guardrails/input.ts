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
 * Keyword / regex spam list (design §8.1, P3). Same treatment as the
 * injection screen: flag + log, never silently rewrite, call proceeds.
 * This is a cheap heuristic for obvious spam (follower-selling, crypto
 * giveaways, "earn money fast") — a dedicated moderation call is a
 * later phase (design §8.1 Phase 2) and is deliberately NOT added here.
 */
const SPAM_KEYWORDS = [
  "buy followers",
  "buy likes",
  "buy subscribers",
  "buy views",
  "earn money fast",
  "make money fast",
  "work from home earn",
  "crypto giveaway",
  "double your bitcoin",
  "double your btc",
  "double your crypto",
  "send 0.1 btc",
  "free iphone",
  "guaranteed income",
  "limited time offer",
  "act now",
];

const SPAM_PATTERNS: RegExp[] = [
  // "earn $500/day", "earn 500 dollars a week"
  /\bearn\s+\$?\d[\d,]*\s*(dollars?|\/day|\/week|\/month)?\b/i,
  // "double/triple your bitcoin/btc/crypto/money"
  /\b(double|triple)\s+your\s+(bitcoin|btc|crypto|money)\b/i,
  // "free iphone/gift card/prize" / "win a ..."
  /\b(free|win a?)\s+(iphone|gift\s?card|prize|giveaway)\b/i,
  // "buy/get followers/likes/subscribers/views"
  /\b(buy|get)\s+(followers|likes|subscribers|views)\b/i,
  // casino / pharma spam
  /\b(casino|viagra|cialis)\b/i,
];

export function detectSpam(text: string): boolean {
  const lower = text.toLowerCase();
  if (SPAM_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return true;
  }
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}

export type InputScreenReason = "prompt-injection" | "spam";

/**
 * Combined input screen for the AI routes: prompt-injection phrases
 * plus the spam list. Flagged inputs are logged (status "flagged" on
 * the AiUsageLog row) and the call still proceeds — never silently
 * rewritten (design §8.1).
 */
export function screenAiInput(text: string): {
  flagged: boolean;
  reasons: InputScreenReason[];
} {
  const reasons: InputScreenReason[] = [];
  if (detectPromptInjection(text)) reasons.push("prompt-injection");
  if (detectSpam(text)) reasons.push("spam");
  return { flagged: reasons.length > 0, reasons };
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
