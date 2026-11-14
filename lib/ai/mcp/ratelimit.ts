/**
 * Per-API-key rate limit for the MCP server (design §6.2): 60
 * requests per minute per key, via Upstash Ratelimit (sliding window).
 *
 * GRACEFUL DEGRADATION, same pattern as lib/ai/ratelimit.ts: when
 * Redis is not configured the limiter does not exist and the call is
 * allowed — the limit is skipped, never blocking. A failed limit
 * check also allows the request (fail open, logged). 429s are logged
 * to AiUsageLog with actorType "api-key" and are never retried by the
 * route.
 *
 * Note: this limits HTTP requests to /api/mcp (one JSON-RPC call per
 * request in stateless mode), keyed by the hashed key id — not by IP,
 * since MCP clients are machines behind unknown networks.
 */
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedisClient } from "@/lib/ai/cache";
import { createUsageLog } from "@/lib/ai/observability";
import type { Types } from "mongoose";

export const MCP_RATE_LIMIT_PER_MINUTE = 60;
const MCP_RATE_LIMIT_WINDOW_SECONDS = 60;

let mcpLimiter: Ratelimit | null | undefined;

function getMcpLimiter(): Ratelimit | null {
  if (mcpLimiter !== undefined) {
    return mcpLimiter;
  }
  const redis = getRedisClient();
  if (!redis) {
    mcpLimiter = null;
    return null;
  }
  mcpLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(
      MCP_RATE_LIMIT_PER_MINUTE,
      `${MCP_RATE_LIMIT_WINDOW_SECONDS} s`
    ),
    prefix: "mcp:ratelimit",
  });
  return mcpLimiter;
}

export interface McpRateLimitResult {
  limited: boolean;
  response?: NextResponse;
}

/**
 * Enforce the 60/min/key limit. Returns `{ limited: false }` to
 * proceed, or `{ limited: true, response }` with a 429 JSON response
 * (Retry-After header included) when the key is over the limit.
 */
export async function enforceMcpRateLimit(
  keyId: string,
  userId: Types.ObjectId
): Promise<McpRateLimitResult> {
  const limiter = getMcpLimiter();
  if (!limiter) {
    // No Redis configured — the limit is skipped, never blocks.
    return { limited: false };
  }
  let result;
  try {
    result = await limiter.limit(`key:${keyId}`);
  } catch (error) {
    console.error("MCP rate limit check failed, allowing request", error);
    return { limited: false };
  }
  if (result.success) {
    return { limited: false };
  }
  try {
    await createUsageLog({
      userId,
      actorType: "api-key",
      promptId: "mcp",
      promptVersion: 1,
      modelName: "none",
      task: "mcp",
      status: "rejected",
      errorCode: "RATE_LIMITED",
    });
  } catch (error) {
    console.error("Failed to log rate-limited MCP call", error);
  }
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.reset - Date.now()) / 1000)
  );
  return {
    limited: true,
    response: NextResponse.json(
      {
        error: `Too many MCP requests. Try again in ${retryAfterSeconds}s.`,
        retryAfter: retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    ),
  };
}
