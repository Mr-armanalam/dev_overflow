/**
 * Per-IP burst limit on /api/ai/* (design §8.1, P3) via Upstash
 * Ratelimit (sliding window).
 *
 * GRACEFUL DEGRADATION: when Redis is not configured the limiter does
 * not exist and every call is allowed — the limit is skipped, never
 * blocking. A failed limit check also allows the request (fail open,
 * logged). 429s are logged to AiUsageLog as "rejected" with errorCode
 * RATE_LIMITED and are never retried client-side.
 */
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import type { Types } from "mongoose";
import { getRedisClient } from "./cache";
import {
  AI_BURST_LIMIT_PER_MINUTE,
  AI_BURST_WINDOW_SECONDS,
} from "./limits";
import { createUsageLog } from "./observability";
import type { AiTask } from "@/database/ai-usage-log.model";

const limiters = new Map<number, Ratelimit | null>();

function getAiBurstLimiter(limitPerMinute: number): Ratelimit | null {
  if (limiters.has(limitPerMinute)) {
    return limiters.get(limitPerMinute) ?? null;
  }
  const redis = getRedisClient();
  if (!redis) {
    limiters.set(limitPerMinute, null);
    return null;
  }
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(
      limitPerMinute,
      `${AI_BURST_WINDOW_SECONDS} s`
    ),
    // Separate keyspace per limit so the similar-questions route
    // (60/min) does not share quota with the button-click routes.
    prefix: `ai:burst:${limitPerMinute}`,
  });
  limiters.set(limitPerMinute, limiter);
  return limiter;
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export interface BurstLimitResult {
  limited: boolean;
  response?: NextResponse;
}

/**
 * Enforce the burst limit for one AI route call. Returns
 * `{ limited: false }` to proceed, or `{ limited: true, response }`
 * with a 429 JSON response (Retry-After header included) when the IP
 * is over the limit.
 *
 * `limitPerMinute` overrides the default 20/min — the
 * similar-questions route passes 60 because it fires on debounced
 * keystrokes while the user types, where 20/min would 429 legitimate
 * use. Each limit has its own keyspace.
 */
export async function enforceAiBurstLimit(
  request: Request,
  userId: Types.ObjectId,
  task: AiTask,
  promptId: string,
  promptVersion: number,
  modelName: string,
  limitPerMinute: number = AI_BURST_LIMIT_PER_MINUTE
): Promise<BurstLimitResult> {
  const limiterInstance = getAiBurstLimiter(limitPerMinute);
  if (!limiterInstance) {
    // No Redis configured — the limit is skipped, never blocks.
    return { limited: false };
  }
  let result;
  try {
    result = await limiterInstance.limit(`ip:${getClientIp(request)}`);
  } catch (error) {
    console.error("AI burst limit check failed, allowing request", error);
    return { limited: false };
  }
  if (result.success) {
    return { limited: false };
  }
  try {
    await createUsageLog({
      userId,
      promptId,
      promptVersion,
      modelName,
      task,
      status: "rejected",
      errorCode: "RATE_LIMITED",
    });
  } catch (error) {
    console.error("Failed to log rate-limited AI call", error);
  }
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.reset - Date.now()) / 1000)
  );
  return {
    limited: true,
    response: NextResponse.json(
      {
        error: `Too many AI requests. Try again in ${retryAfterSeconds}s.`,
        retryAfter: retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    ),
  };
}
