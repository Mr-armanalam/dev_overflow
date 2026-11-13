/**
 * Upstash Redis cache for the AI routes (design §8.2, P3).
 *
 * GRACEFUL DEGRADATION (no Upstash account yet): every function in
 * this module is a no-op returning null when
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are absent — the
 * routes take the normal provider path and log `cacheHit: false`.
 * Nothing here ever throws for a missing client or a failed Redis
 * command; failures are logged and treated as a cache miss. See
 * docs/upstash-setup.md for the free-tier setup steps.
 *
 * Two caches:
 * - Exact cache: SHA-256 of (promptId + version + normalised input)
 *   -> the full response, TTL per task (24 h for draft/tag/duplicate,
 *   7 days reserved for the future summarise-thread task).
 * - Semantic cache: no second embedding store. A draft is also stored
 *   under its question id; on a new draft request the P2 retrieval
 *   path returns the closest question with its cosine — when that
 *   cosine is >= 0.95 the stored draft for that question is served,
 *   marked "from a similar question".
 */
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

/** TTL per task, in seconds (design §8.2). */
export const AI_CACHE_TTLS_SECONDS: Record<string, number> = {
  "answer-draft": 24 * 60 * 60,
  "tag-suggest": 24 * 60 * 60,
  "duplicate-detect": 24 * 60 * 60,
  // Reserved: no summarise-thread task exists yet (P5). The entry is
  // here so the table is complete per the design.
  "summarise-thread": 7 * 24 * 60 * 60,
};

let redisClient: Redis | null | undefined; // undefined = not attempted yet

/** Lazy singleton. Null when Upstash env vars are absent or the
 *  client cannot be constructed — callers treat null as "no cache". */
export function getRedisClient(): Redis | null {
  if (redisClient !== undefined) {
    return redisClient;
  }
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redisClient = null;
    return null;
  }
  try {
    redisClient = new Redis({ url, token });
  } catch (error) {
    console.error("AI cache: could not create Upstash client", error);
    redisClient = null;
  }
  return redisClient;
}

export function isCacheConfigured(): boolean {
  return getRedisClient() !== null;
}

/** SHA-256 of (promptId + version + normalised input). */
export function exactCacheKey(
  promptId: string,
  version: number,
  normalisedInput: string
): string {
  return `ai:cache:exact:${createHash("sha256")
    .update(`${promptId}:v${version}:${normalisedInput}`)
    .digest("hex")}`;
}

export async function getExactCache<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    // Upstash may return the stored JSON string or an already-parsed
    // object, depending on client version — handle both.
    if (typeof raw === "string") {
      return JSON.parse(raw) as T;
    }
    return raw as T;
  } catch (error) {
    console.error("AI exact-cache read failed, treating as miss", error);
    return null;
  }
}

export async function setExactCache(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
  } catch (error) {
    console.error("AI exact-cache write failed, continuing", error);
  }
}

/** One RAG source, as served to the client (matches Answer.tsx). */
export interface CachedSource {
  n: number;
  questionId: string;
  title: string;
  score: number;
}

export interface CachedDraft {
  text: string;
  sources: CachedSource[];
  modelName: string;
  promptId: string;
  promptVersion: number;
}

/** Draft stored under its question id — the semantic-cache lookup. */
export function draftCacheKeyByQuestion(questionId: string): string {
  return `ai:cache:draft:by-question:${questionId}`;
}

export async function getCachedDraftByQuestion(
  questionId: string
): Promise<CachedDraft | null> {
  return getExactCache<CachedDraft>(draftCacheKeyByQuestion(questionId));
}

export async function setCachedDraftByQuestion(
  questionId: string,
  draft: CachedDraft
): Promise<void> {
  await setExactCache(
    draftCacheKeyByQuestion(questionId),
    draft,
    AI_CACHE_TTLS_SECONDS["answer-draft"]
  );
}
