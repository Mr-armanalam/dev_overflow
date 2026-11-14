/**
 * POST /api/ai/draft — streaming answer draft (design §3.3, §4.2.1).
 * Thin handler: auth → validate → rate limit → load question →
 * cache → budget → lib/ai → stream. Never calls the provider
 * directly, never trusts client-supplied question text (title/content
 * are loaded from the database by questionId).
 *
 * The response is a plain text stream (AI SDK `toTextStreamResponse`).
 * The usage-log row id travels in the `x-ai-usage-log-id` header so
 * the client can attach feedback thumbs to the call.
 *
 * P3 additions:
 * - Exact cache (SHA-256 of promptId + version + question) and
 *   semantic cache (best retrieved cosine >= 0.95 reuses the stored
 *   draft for that question, marked "from a similar question").
 *   Cache hits never consume the daily budget and are served even
 *   when the budget is exhausted or the kill switch is on. When
 *   Upstash env vars are absent the cache is skipped entirely
 *   (graceful degradation — see lib/ai/cache.ts).
 * - Per-IP burst limit (429s logged, never retried client-side).
 * - Degraded mode: when the provider is down, the budget is
 *   exhausted, or the kill switch is on, the response carries similar
 *   questions + a "try again later" state instead of a bare error.
 * - Cache-hit responses carry `x-ai-cache: exact | semantic` (and
 *   `x-ai-similar-question-id` / `-title` for semantic hits) so the
 *   client can label them.
 *
 * Human-in-the-loop: this only produces a draft. Nothing is posted
 * here — the user reviews, edits and submits from the answer form.
 */
import { NextResponse } from "next/server";
import type { Types } from "mongoose";
import { getAuthenticatedUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongoose";
import Question from "@/database/question.model";
import AiDraft from "@/database/ai-draft.model";
import {
  AI_SEMANTIC_CACHE_MIN_COSINE,
  isAiEnabled,
} from "@/lib/ai/limits";
import {
  AiDraftInputSchema,
  screenAiInput,
  scrubPII,
  stripHtmlToText,
} from "@/lib/ai/guardrails/input";
import { scrubOutput } from "@/lib/ai/guardrails/output";
import {
  AI_CACHE_TTLS_SECONDS as CACHE_TTLS,
  exactCacheKey,
  getCachedDraftByQuestion,
  getExactCache,
  setCachedDraftByQuestion,
  setExactCache,
  type CachedDraft,
} from "@/lib/ai/cache";
import { enforceAiBurstLimit } from "@/lib/ai/ratelimit";
import { getDegradedSimilarQuestions } from "@/lib/ai/degraded";
import {
  ANSWER_DRAFT_V2,
  buildAnswerDraftPrompt,
} from "@/lib/ai/prompts/answer-draft.v2";
import { retrieveSimilar } from "@/lib/ai/rag/retrieve";
import { getLlmProvider, getModelForTask } from "@/lib/ai/router";
import { checkDailyBudget, isEligibleForAiDraft } from "@/lib/ai/budgets";
import { createUsageLog, updateUsageLog } from "@/lib/ai/observability";
import { AI_DRAFT_MAX_CONTENT_CHARS } from "@/lib/ai/limits";

export const POST = async (request: Request) => {
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
  const model = getModelForTask("answer-draft");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
  const parsed = AiDraftInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Per-IP burst limit (P3). Skipped entirely when Redis is not
  // configured; a failed check fails open (allows the request).
  const burst = await enforceAiBurstLimit(
    request,
    userId,
    "answer-draft",
    ANSWER_DRAFT_V2.id,
    ANSWER_DRAFT_V2.version,
    model
  );
  if (burst.limited) {
    return burst.response;
  }

  // Minimum-reputation rule (design §8.1, P3): a brand-new account
  // with negative reputation may not use AI drafts. P1 did not
  // implement this check; the threshold is the design's own.
  if (!isEligibleForAiDraft(mongoUser)) {
    try {
      await createUsageLog({
        userId,
        promptId: ANSWER_DRAFT_V2.id,
        promptVersion: ANSWER_DRAFT_V2.version,
        modelName: model,
        task: "answer-draft",
        status: "rejected",
        errorCode: "ACCOUNT_TOO_NEW",
      });
    } catch (error) {
      console.error("Failed to log rejected AI draft call", error);
    }
    return NextResponse.json(
      {
        error:
          "AI drafts are not available for brand-new accounts with negative reputation yet. Ask or answer a question first.",
      },
      { status: 403 }
    );
  }

  // Title/content come from the database, never from the client.
  await connectToDatabase();
  const question = await Question.findById(parsed.data.questionId);
  if (!question) {
    return NextResponse.json(
      { error: "Question not found" },
      { status: 404 }
    );
  }
  const title = scrubPII(question.title);
  const content = scrubPII(
    stripHtmlToText(question.content).slice(0, AI_DRAFT_MAX_CONTENT_CHARS)
  );
  // Flagged, never silently rewritten: the call proceeds and the log
  // row carries status "flagged". The screen covers prompt-injection
  // phrases and the P3 spam list.
  const { flagged } = screenAiInput(`${title}\n${content}`);

  // Exact cache (P3): same prompt version + same question content.
  // A hit serves the stored draft with no provider call and no
  // budget consumption — even when the kill switch is on.
  const cacheKey = exactCacheKey(
    ANSWER_DRAFT_V2.id,
    ANSWER_DRAFT_V2.version,
    `${parsed.data.questionId}\n${title}\n${content}`
  );
  const exactHit = await getExactCache<CachedDraft>(cacheKey);
  if (exactHit) {
    return serveCachedDraft({ userId, cached: exactHit, kind: "exact" });
  }

  // Kill switch (P1): with no cache hit, serve similar questions +
  // a "try again later" state instead of a bare 503. No provider
  // call of any kind happens while the switch is off — not even the
  // embedding call behind retrieveSimilar.
  if (!isAiEnabled()) {
    const similarQuestions = await getDegradedSimilarQuestions(title);
    return NextResponse.json(
      {
        error: "AI features are temporarily unavailable",
        degraded: true,
        tryAgainLater: true,
        similarQuestions,
      },
      { status: 503 }
    );
  }

  // RAG (P2): retrieve similar questions for citations. Retrieval is
  // best-effort — an empty list means the v2 prompt tells the model to
  // say "No similar questions found" instead of hallucinating sources.
  const sources = await retrieveSimilar({
    text: `${title}\n${content}`,
    excludeQuestionId: String(question._id),
  });
  const context = sources.map((source, i) => ({
    index: i + 1,
    questionId: source.questionId,
    title: source.title,
    // RAG excerpts come from other users' questions/answers — scrub
    // them like any prompt input so a secret pasted in a question
    // can never be echoed back through a draft.
    excerpt: scrubPII(source.snippet),
  }));

  // Semantic cache (P3): when the closest retrieved question is
  // nearly identical (cosine >= 0.95) and a draft is already stored
  // for it, serve that draft marked "from a similar question".
  // Reuses the P2 retrieval path — no second embedding store.
  const closest = sources.reduce(
    (best, source) => (source.cosine > best.cosine ? source : best),
    sources[0]
  );
  if (closest && closest.cosine >= AI_SEMANTIC_CACHE_MIN_COSINE) {
    const semanticHit = await getCachedDraftByQuestion(closest.questionId);
    if (semanticHit) {
      return serveCachedDraft({
        userId,
        cached: semanticHit,
        kind: "semantic",
        similarQuestion: {
          id: closest.questionId,
          title: closest.title,
        },
      });
    }
  }

  // Budget is enforced before any provider call. A cache hit above
  // already returned, so a miss here is a real provider call.
  const budget = await checkDailyBudget(userId, "answer-draft");
  if (!budget.allowed) {
    try {
      await createUsageLog({
        userId,
        promptId: ANSWER_DRAFT_V2.id,
        promptVersion: ANSWER_DRAFT_V2.version,
        modelName: model,
        task: "answer-draft",
        status: "rejected",
        errorCode: "BUDGET_EXCEEDED",
      });
    } catch (error) {
      console.error("Failed to log rejected AI draft call", error);
    }
    // Degraded mode: the retrieved similar questions are served with
    // the 429 instead of a bare error.
    return NextResponse.json(
      {
        error: `Daily AI draft limit reached (${budget.limit}/day). Try again tomorrow.`,
        retryAfter: budget.retryAfterSeconds,
        degraded: true,
        tryAgainLater: true,
        similarQuestions: sources.slice(0, 5).map((source) => ({
          questionId: source.questionId,
          title: source.title,
        })),
      },
      { status: 429 }
    );
  }

  const startedAt = Date.now();

  let usageLog;
  try {
    usageLog = await createUsageLog({
      userId,
      promptId: ANSWER_DRAFT_V2.id,
      promptVersion: ANSWER_DRAFT_V2.version,
      modelName: model,
      task: "answer-draft",
      status: flagged ? "flagged" : "pending",
    });
  } catch (error) {
    console.error("Failed to create AI usage log row", error);
    return NextResponse.json(
      { error: "Could not start the AI draft" },
      { status: 500 }
    );
  }
  const usageLogId = String(usageLog._id);

  const provider = getLlmProvider();
  let result;
  try {
    result = await provider.stream({
      system: ANSWER_DRAFT_V2.system,
      prompt: buildAnswerDraftPrompt({ title, content, context }),
      model,
      maxTokens: 2048,
      // Best-effort per-chunk scrub of echoed secrets (P3 output
      // guardrail). The reliable controls are the input scrub and the
      // full-text scrub of the stored draft below.
      scrubTextChunks: scrubOutput,
      onFinish: async (finish) => {
        try {
          await updateUsageLog(usageLogId, {
            inputTokens: finish.usage.inputTokens,
            outputTokens: finish.usage.outputTokens,
            latencyMs: Date.now() - startedAt,
            status: flagged ? "flagged" : "success",
          });
          const draftText = scrubOutput(finish.text);
          await connectToDatabase();
          await AiDraft.create({
            userId,
            questionId: parsed.data.questionId,
            // Strip any secrets the model echoed before storing.
            content: draftText,
            promptId: ANSWER_DRAFT_V2.id,
            promptVersion: ANSWER_DRAFT_V2.version,
            modelName: model,
            status: "generated",
          });
          // Store for the exact + semantic caches (P3). Best-effort:
          // a cache write failure must never break the response.
          const cached: CachedDraft = {
            text: draftText,
            sources: sources.map((source, i) => ({
              n: i + 1,
              questionId: source.questionId,
              title: source.title,
              score: Math.round(source.score * 1000) / 1000,
            })),
            modelName: model,
            promptId: ANSWER_DRAFT_V2.id,
            promptVersion: ANSWER_DRAFT_V2.version,
          };
          await setExactCache(
            cacheKey,
            cached,
            CACHE_TTLS["answer-draft"]
          );
          await setCachedDraftByQuestion(
            String(question._id),
            cached
          );
        } catch (error) {
          // Logging must never break the response the user already got.
          console.error("Failed to log finished AI draft", error);
        }
      },
      onError: async (error) => {
        try {
          await updateUsageLog(usageLogId, {
            latencyMs: Date.now() - startedAt,
            status: "error",
            errorCode:
              error instanceof Error
                ? error.message.slice(0, 200)
                : "STREAM_ERROR",
          });
        } catch (logError) {
          console.error("Failed to log failed AI draft", logError);
        }
      },
    });
  } catch {
    // Setup-time failure (missing key, provider validation) — no
    // tokens streamed, so the call did not consume budget. Degraded
    // mode: serve the retrieved similar questions with the error.
    try {
      await updateUsageLog(usageLogId, {
        latencyMs: Date.now() - startedAt,
        status: "error",
        errorCode: "PROVIDER_ERROR",
      });
    } catch (error) {
      console.error("Failed to log failed AI draft", error);
    }
    return NextResponse.json(
      {
        error: "AI draft failed. Please try again.",
        degraded: true,
        tryAgainLater: true,
        similarQuestions: sources.slice(0, 5).map((source) => ({
          questionId: source.questionId,
          title: source.title,
        })),
      },
      { status: 502 }
    );
  }

  // Sources travel in a header (URI-encoded JSON: titles may contain
  // non-ASCII characters). The client renders them as a "Sources"
  // list with links; the [n] markers in the draft text match `n`.
  return result.toTextStreamResponse({
    headers: {
      "x-ai-usage-log-id": usageLogId,
      "x-ai-sources": encodeURIComponent(
        JSON.stringify(
          sources.map((source, i) => ({
            n: i + 1,
            questionId: source.questionId,
            title: source.title,
            score: Math.round(source.score * 1000) / 1000,
          }))
        )
      ),
    },
  });
};

/**
 * Serve a cached draft as a plain-text response with the same headers
 * the streaming path sends, plus `x-ai-cache` so the client can label
 * it ("Served from cache" / "From a similar question"). A usage-log
 * row is written with cacheHit: true — it never counts toward the
 * daily budget.
 */
async function serveCachedDraft(params: {
  userId: Types.ObjectId;
  cached: CachedDraft;
  kind: "exact" | "semantic";
  similarQuestion?: { id: string; title: string };
}): Promise<Response> {
  const startedAt = Date.now();
  let usageLogId: string | undefined;
  try {
    const log = await createUsageLog({
      userId: params.userId,
      promptId: params.cached.promptId,
      promptVersion: params.cached.promptVersion,
      modelName: params.cached.modelName,
      task: "answer-draft",
      status: "success",
      cacheHit: true,
      latencyMs: Date.now() - startedAt,
    });
    usageLogId = String(log._id);
  } catch (error) {
    // A logging failure must never take a cache hit away.
    console.error("Failed to log cached AI draft", error);
  }

  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "x-ai-cache": params.kind,
    "x-ai-sources": encodeURIComponent(
      JSON.stringify(params.cached.sources)
    ),
  };
  if (usageLogId) {
    headers["x-ai-usage-log-id"] = usageLogId;
  }
  if (params.similarQuestion) {
    headers["x-ai-similar-question-id"] = params.similarQuestion.id;
    headers["x-ai-similar-question-title"] = params.similarQuestion.title;
  }
  return new Response(params.cached.text, { headers });
}
