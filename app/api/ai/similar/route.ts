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
  scrubPII,
} from "@/lib/ai/guardrails/input";
import { retrieveSimilar } from "@/lib/ai/rag/retrieve";
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

  const title = scrubPII(parsed.data.title);
  const bodyText = parsed.data.body ? scrubPII(parsed.data.body) : "";
  const excludeQuestionId = parsed.data.excludeQuestionId;

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
  } | null = null;
  const best = sources[0];
  if (best && best.cosine >= DUPLICATE_COSINE_TRIGGER) {
    const model = getModelForTask("duplicate-detect");
    const startedAt = Date.now();
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
      const { object, usage, latencyMs } = await provider.generateObject({
        system: DUPLICATE_DETECT_V1.system,
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
      });
      if (usageLog) {
        await updateUsageLog(String(usageLog._id), {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs,
          status: "success",
        });
      }
      const match = sources.find(
        (source) => source.questionId === object.duplicateOfId
      );
      if (
        object.isDuplicate &&
        object.confidence >= DUPLICATE_MIN_CONFIDENCE &&
        match
      ) {
        duplicate = {
          questionId: match.questionId,
          title: match.title,
          confidence: Math.round(object.confidence * 100) / 100,
          reason: object.reason,
        };
      }
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
