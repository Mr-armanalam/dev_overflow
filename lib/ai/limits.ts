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
 * Global kill switch: `AI_ENABLED=false` makes every /api/ai/* route
 * return 503. Anything else (including unset) means enabled.
 */
export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED !== "false";
}
