/**
 * POST /api/ai/draft — streaming answer draft (design §3.3, §4.2.1).
 * Thin handler: auth → validate → budget → lib/ai → stream. Never
 * calls the provider directly, never trusts client-supplied question
 * text (title/content are loaded from the database by questionId).
 *
 * The response is a plain text stream (AI SDK `toTextStreamResponse`).
 * The usage-log row id travels in the `x-ai-usage-log-id` header so
 * the client can attach feedback thumbs to the call.
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
import { isAiEnabled } from "@/lib/ai/limits";
import {
  AiDraftInputSchema,
  detectPromptInjection,
  scrubPII,
  stripHtmlToText,
} from "@/lib/ai/guardrails/input";
import {
  ANSWER_DRAFT_V1,
  buildAnswerDraftPrompt,
} from "@/lib/ai/prompts/answer-draft.v1";
import { getLlmProvider, getModelForTask } from "@/lib/ai/router";
import { checkDailyBudget } from "@/lib/ai/budgets";
import { createUsageLog, updateUsageLog } from "@/lib/ai/observability";
import { AI_DRAFT_MAX_CONTENT_CHARS } from "@/lib/ai/limits";

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
  const parsed = AiDraftInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Budget is enforced before any provider call.
  const budget = await checkDailyBudget(userId, "answer-draft");
  if (!budget.allowed) {
    try {
      await createUsageLog({
        userId,
        promptId: ANSWER_DRAFT_V1.id,
        promptVersion: ANSWER_DRAFT_V1.version,
        modelName: getModelForTask("answer-draft"),
        task: "answer-draft",
        status: "rejected",
        errorCode: "BUDGET_EXCEEDED",
      });
    } catch (error) {
      console.error("Failed to log rejected AI draft call", error);
    }
    return NextResponse.json(
      {
        error: `Daily AI draft limit reached (${budget.limit}/day). Try again tomorrow.`,
        retryAfter: budget.retryAfterSeconds,
      },
      { status: 429 }
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
  // row carries status "flagged".
  const flagged = detectPromptInjection(`${title}\n${content}`);
  const model = getModelForTask("answer-draft");
  const startedAt = Date.now();

  let usageLog;
  try {
    usageLog = await createUsageLog({
      userId,
      promptId: ANSWER_DRAFT_V1.id,
      promptVersion: ANSWER_DRAFT_V1.version,
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
      system: ANSWER_DRAFT_V1.system,
      prompt: buildAnswerDraftPrompt({ title, content }),
      model,
      maxTokens: 2048,
      onFinish: async (finish) => {
        try {
          await updateUsageLog(usageLogId, {
            inputTokens: finish.usage.inputTokens,
            outputTokens: finish.usage.outputTokens,
            latencyMs: Date.now() - startedAt,
            status: flagged ? "flagged" : "success",
          });
          await connectToDatabase();
          await AiDraft.create({
            userId,
            questionId: parsed.data.questionId,
            content: finish.text,
            promptId: ANSWER_DRAFT_V1.id,
            promptVersion: ANSWER_DRAFT_V1.version,
            modelName: model,
            status: "generated",
          });
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
    // tokens streamed, so the call did not consume budget.
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
      { error: "AI draft failed. Please try again." },
      { status: 502 }
    );
  }

  return result.toTextStreamResponse({
    headers: { "x-ai-usage-log-id": usageLogId },
  });
};
