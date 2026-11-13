/**
 * POST /api/ai/similar — live "similar questions" for the ask-question
 * form (design §5.2, §8.3) + duplicate detection (design §4.2.3).
 *
 * Thin handler: auth → validate → retrieve (no LLM call for the list
 * itself) → duplicate check only when the best candidate is very
 * close (cosine ≥ 0.8). Thresholds, enforced here:
 * - similar list: reranked score ≥ 0.5, top 5
 * - duplicate suggestion: LLM verdict isDuplicate AND confidence ≥ 0.8
 *
 * NEVER auto-closes anything: the response only suggests, the user
 * decides. The retrieval embedding call itself is not logged (it is
 * infrastructure, not a user-facing AI feature); the duplicate-detect
 * LLM call is logged to AiUsageLog like any other AI call.
 */
import { NextResponse } from "next/server";
import type { Types } from "mongoose";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAiEnabled } from "@/lib/ai/limits";
import {
  AiSimilarInputSchema,
  screenAiInput,
  scrubPII,
} from "@/lib/ai/guardrails/input";
import {
  STRUCTURED_OUTPUT_REPAIR_INSTRUCTION,
  withStructuredOutputRepair,
} from "@/lib/ai/guardrails/output";
import { retrieveSimilar } from "@/lib/ai/rag/retrieve";
import { recordDuplicateSuggestion } from "@/lib/ai/duplicates";
import {
  AI_CACHE_TTLS_SECONDS,
  exactCacheKey,
  getExactCache,
  setExactCache,
} from "@/lib/ai/cache";
import { enforceAiBurstLimit } from "@/lib/ai/ratelimit";
import { AI_SIMILAR_BURST_LIMIT_PER_MINUTE } from "@/lib/ai/limits";
import {
  DUPLICATE_DETECT_V1,
  buildDuplicateDetectPrompt,
} from "@/lib/ai/prompts/duplicate-detect.v1";
import { getLlmProvider, getModelForTask } from "@/lib/ai/router";
import { createUsageLog, updateUsageLog } from "@/lib/ai/observability";

/** Candidates below this reranked score are not shown as similar. */
const SIMILAR_MIN_SCORE = 0.5;
/** Only a very close cosine match triggers the duplicate LLM check. */
const DUPLICATE_COSINE_TRIGGER = 0.8;
/** The duplicate suggestion is shown only at this LLM confidence. */
const DUPLICATE_MIN_CONFIDENCE = 0.8;

const DuplicateDetectResponseSchema = z.object({
  isDuplicate: z.boolean(),
  confidence: z.number().min(0).max(1),
  duplicateOfId: z.string().optional(),
  reason: z.string(),
});

export const POST = async (request: Request) => {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "AI features are temporarily unavailable" },
      { status: 503 }
    );
  }

  let mongoUser;
  try {
    mongoUser = await getAuthenticatedUser();
  } catch {
    return NextResponse.json(
      { error: "Unauthorized: please sign in" },
      { status: 401 }
    );
  }
  const userId = mongoUser._id as Types.ObjectId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
  const parsed = AiSimilarInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Per-IP burst limit (P3) — 60/min here, not the default 20/min:
  // this route fires on debounced keystrokes while the user types.
  // Skipped entirely when Redis is not configured.
  const burst = await enforceAiBurstLimit(
    request,
    userId,
    "duplicate-detect",
    DUPLICATE_DETECT_V1.id,
    DUPLICATE_DETECT_V1.version,
    getModelForTask("duplicate-detect"),
    AI_SIMILAR_BURST_LIMIT_PER_MINUTE
  );
  if (burst.limited) {
    return burst.response;
  }

  const title = scrubPII(parsed.data.title);
  const bodyText = parsed.data.body ? scrubPII(parsed.data.body) : "";
  const excludeQuestionId = parsed.data.excludeQuestionId;
  // Input screen (P3): flagged inputs are logged on the duplicate
  // row below; the similar list itself is unaffected.
  const { flagged } = screenAiInput(
    bodyText ? `${title}\n${bodyText}` : title
  );

  const sources = await retrieveSimilar({
    text: bodyText ? `${title}\n${bodyText}` : title,
    excludeQuestionId,
  });
  const results = sources
    .filter((source) => source.score >= SIMILAR_MIN_SCORE)
    .map((source) => ({
      questionId: source.questionId,
      title: source.title,
      snippet: source.snippet,
      score: Math.round(source.score * 1000) / 1000,
    }));

  // Duplicate check: only when the closest match is very similar, so
  // ordinary typing does not spend an LLM call per keystroke.
  let duplicate: {
    questionId: string;
    title: string;
    confidence: number;
    reason: string;
    /** Row id in the moderator review queue (/admin/duplicates). */
    suggestionId?: string;
  } | null = null;

  const applyDuplicateVerdict = async (
    verdict: z.infer<typeof DuplicateDetectResponseSchema>
  ): Promise<void> => {
    const match = sources.find(
      (source) => source.questionId === verdict.duplicateOfId
    );
    if (
      verdict.isDuplicate &&
      verdict.confidence >= DUPLICATE_MIN_CONFIDENCE &&
      match
    ) {
      duplicate = {
        questionId: match.questionId,
        title: match.title,
        confidence: Math.round(verdict.confidence * 100) / 100,
        reason: verdict.reason,
      };
      // Moderator review queue (P3): record the suggestion so a
      // moderator can confirm/reject it on /admin/duplicates.
      // Deduped per asker + original + draft title (24 h). The
      // ask-question form links the submitted question afterwards.
      const suggestion = await recordDuplicateSuggestion({
        suggestedBy: userId,
        draftTitle: title,
        draftBody: bodyText || undefined,
        duplicateOfId: match.questionId,
        confidence: duplicate.confidence,
        reason: verdict.reason,
      });
      if (suggestion) {
        duplicate.suggestionId = String(suggestion._id);
      }
    }
  };

  const best = sources[0];
  if (best && best.cosine >= DUPLICATE_COSINE_TRIGGER) {
    const model = getModelForTask("duplicate-detect");
    const startedAt = Date.now();

    // Exact cache (P3) for the duplicate verdict: same prompt version
    // + same title/body + same top candidates. The retrieval itself
    // is not cached — only the LLM verdict.
    const verdictCacheKey = exactCacheKey(
      DUPLICATE_DETECT_V1.id,
      DUPLICATE_DETECT_V1.version,
      `${title}\n${bodyText}\n${sources
        .map((source) => source.questionId)
        .join(",")}`
    );
    const cachedVerdict =
      await getExactCache<
        z.infer<typeof DuplicateDetectResponseSchema>
      >(verdictCacheKey);
    if (cachedVerdict) {
      try {
        await createUsageLog({
          userId,
          promptId: DUPLICATE_DETECT_V1.id,
          promptVersion: DUPLICATE_DETECT_V1.version,
          modelName: model,
          task: "duplicate-detect",
          status: "success",
          cacheHit: true,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        console.error("Failed to log cached duplicate-detect call", error);
      }
      await applyDuplicateVerdict(cachedVerdict);
      return NextResponse.json({ results, duplicate });
    }

    let usageLog;
    try {
      usageLog = await createUsageLog({
        userId,
        promptId: DUPLICATE_DETECT_V1.id,
        promptVersion: DUPLICATE_DETECT_V1.version,
        modelName: model,
        task: "duplicate-detect",
        status: "pending",
      });
    } catch (error) {
      console.error("Failed to create duplicate-detect usage log", error);
    }
    try {
      const provider = getLlmProvider();
      // Structured output with ONE repair retry (P3 output guardrail):
      // a parse failure retries once with an explicit "valid JSON
      // only" instruction, then fails soft (the catch below keeps the
      // similar list — a failed duplicate check never takes it away).
      const { object, usage, latencyMs } = await withStructuredOutputRepair(
        (repair) =>
          provider.generateObject({
            system:
              DUPLICATE_DETECT_V1.system +
              (repair
                ? `\n\n${STRUCTURED_OUTPUT_REPAIR_INSTRUCTION}`
                : ""),
            prompt: buildDuplicateDetectPrompt({
              title,
              body: bodyText,
              candidates: sources.map((source) => ({
                questionId: source.questionId,
                title: source.title,
                excerpt: source.snippet,
              })),
            }),
            model,
            schema: DuplicateDetectResponseSchema,
            maxTokens: 512,
          })
      );
      if (usageLog) {
        await updateUsageLog(String(usageLog._id), {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs,
          status: flagged ? "flagged" : "success",
        });
      }
      await setExactCache(
        verdictCacheKey,
        object,
        AI_CACHE_TTLS_SECONDS["duplicate-detect"]
      );
      await applyDuplicateVerdict(object);
    } catch (error) {
      // A failed duplicate check must not take the similar list away.
      console.error("Duplicate-detect call failed", error);
      if (usageLog) {
        try {
          await updateUsageLog(String(usageLog._id), {
            latencyMs: Date.now() - startedAt,
            status: "error",
            errorCode:
              error instanceof Error
                ? error.message.slice(0, 200)
                : "PROVIDER_ERROR",
          });
        } catch (logError) {
          console.error("Failed to log duplicate-detect error", logError);
        }
      }
    }
  }

  return NextResponse.json({ results, duplicate });
};
