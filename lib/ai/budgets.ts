/**
 * Per-user daily budgets (design §3.3), enforced before any provider
 * call. Only rows that consumed a provider call count: "success" and
 * "flagged" (flagged inputs still generated). "rejected" and "error"
 * rows never count, and "pending" rows (a stream still in flight) do
 * not count either — a double-click can therefore slip one extra call
 * past the limit; accepted for P1, the UI disables the button while
 * a call is in flight.
 */
import { Types } from "mongoose";
import AiUsageLog, { type AiTask } from "@/database/ai-usage-log.model";
import { connectToDatabase } from "@/lib/mongoose";
import {
  AI_DRAFT_DAILY_BUDGET,
  AI_DRAFT_MIN_ACCOUNT_AGE_MS,
  AI_TAG_SUGGEST_DAILY_BUDGET,
} from "./limits";

/**
 * Minimum-reputation rule for AI drafts (design §8.1): the call is
 * allowed when the account is at least 24 h old OR reputation is
 * >= 0. Only a brand-new account with negative reputation is blocked.
 * P1 did not implement this check; P3 adds it at the design
 * threshold — the threshold itself is unchanged from the design.
 */
export function isEligibleForAiDraft(user: {
  reputation?: number;
  joinedAt?: Date;
}): boolean {
  if ((user.reputation ?? 0) >= 0) {
    return true;
  }
  const joinedAtMs = user.joinedAt
    ? new Date(user.joinedAt).getTime()
    : 0;
  return Date.now() - joinedAtMs >= AI_DRAFT_MIN_ACCOUNT_AGE_MS;
}

export function startOfTodayUtc(): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

export function secondsUntilNextUtcMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((nextMidnight.getTime() - now.getTime()) / 1000));
}

export function dailyBudgetFor(task: AiTask): number {
  if (task === "answer-draft") return AI_DRAFT_DAILY_BUDGET;
  if (task === "tag-suggest") return AI_TAG_SUGGEST_DAILY_BUDGET;
  // "embedding" and "duplicate-detect" are system-side calls, never
  // user-budget-gated: indexing runs fire-and-forget on write, and the
  // duplicate check rides on the ask-question flow. They are still
  // logged to AiUsageLog for observability.
  return Number.POSITIVE_INFINITY;
}

export async function countTodayConsumedCalls(
  userId: Types.ObjectId,
  task: AiTask
): Promise<number> {
  await connectToDatabase();
  return AiUsageLog.countDocuments({
    userId,
    task,
    status: { $in: ["success", "flagged"] },
    // Cache hits consumed no provider call (P3), so they never count
    // toward the daily budget.
    cacheHit: false,
    createdAt: { $gte: startOfTodayUtc() },
  });
}

export interface BudgetCheck {
  allowed: boolean;
  used: number;
  limit: number;
  retryAfterSeconds: number;
}

export async function checkDailyBudget(
  userId: Types.ObjectId,
  task: AiTask
): Promise<BudgetCheck> {
  const used = await countTodayConsumedCalls(userId, task);
  const limit = dailyBudgetFor(task);
  return {
    allowed: used < limit,
    used,
    limit,
    retryAfterSeconds: secondsUntilNextUtcMidnight(),
  };
}
