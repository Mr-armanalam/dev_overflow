/**
 * Single source of truth for P1 AI limits (design §3.3).
 * Budgets are per user, per day (UTC), enforced in lib/ai/budgets.ts
 * before any provider call. Arman's decisions, 13 Nov 2026:
 * 10 answer drafts + 20 tag-suggest calls per user per day.
 */

export const AI_DRAFT_DAILY_BUDGET = 10;
export const AI_TAG_SUGGEST_DAILY_BUDGET = 20;

/** Timeout for a single provider call (both P1 tasks use flash). */
export const AI_CALL_TIMEOUT_MS = 15_000;

/** Retries on 429/5xx only, exponential backoff + jitter. Never on 400. */
export const AI_MAX_RETRIES = 2;

/** Input length caps enforced by Zod on the AI routes. */
export const AI_DRAFT_MAX_CONTENT_CHARS = 5000;
export const AI_TAG_SUGGEST_MAX_TITLE_CHARS = 130;
export const AI_TAG_SUGGEST_MAX_BODY_CHARS = 5000;

/**
 * Per-IP burst limit on /api/ai/* (design §8.1, P3, Upstash Ratelimit).
 * 20 requests per 60 s per IP — generous for human use (the ask form
 * debounces similar-questions lookups), tight enough to blunt a burst.
 * 429s are logged to AiUsageLog, never retried client-side.
 */
export const AI_BURST_LIMIT_PER_MINUTE = 20;
export const AI_BURST_WINDOW_SECONDS = 60;

/**
 * Burst limit for POST /api/ai/similar (P3). Higher than the default
 * 20/min: the route fires on debounced keystrokes while the user
 * types a title, so 20/min would 429 legitimate use.
 */
export const AI_SIMILAR_BURST_LIMIT_PER_MINUTE = 60;

/**
 * Minimum account age for AI drafts (design §8.1). P1 did NOT
 * implement this rule (verified 13 Nov 2026 — no reputation/joinedAt
 * check existed in lib/ai); P3 adds it at the design threshold: an
 * account younger than 24 h needs reputation >= 0. In practice that
 * blocks only brand-new accounts that already have negative
 * reputation (reputation defaults to 0).
 */
export const AI_DRAFT_MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Semantic-cache hit threshold (design §8.2, P3): a cached draft is
 * reused only when the best retrieved question is this similar
 * (cosine) to the incoming question.
 */
export const AI_SEMANTIC_CACHE_MIN_COSINE = 0.95;

/**
 * Global kill switch: `AI_ENABLED=false` makes every /api/ai/* route
 * return 503. Anything else (including unset) means enabled.
 */
export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED !== "false";
}
