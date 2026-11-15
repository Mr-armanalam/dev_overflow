/**
 * Self-validation for AI drafts (answer-grounded drafts, v3).
 *
 * The draft route generates from retrieved community answers; this
 * module checks the result against those same answers with a second
 * model call — a strict reviewer that verifies each [n] citation
 * actually supports its claim, flags claims contradicting a
 * higher-upvoted answer, and catches code that would not run. It
 * does NOT guarantee correctness: a wrong but highly-upvoted
 * community answer can still pass through, and the human review step
 * in the answer form stays.
 *
 * Validation never breaks the draft: any failure (retrieval,
 * provider, schema) returns verdict "unavailable" and the client
 * keeps the original draft. Exactly ONE generateObject call — no
 * repair retry (the P3 repair pattern is deliberately not used here;
 * the budget for a draft is the stream + this one call).
 *
 * No extra budget consumption: validation is part of the draft
 * request that already passed the budget check. Its tokens are added
 * to that request's AiUsageLog row, and a revised draft replaces the
 * stored draft + cached copies (best-effort, never breaking).
 */
import { z } from "zod";
import type { Types } from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import Question from "@/database/question.model";
import AiDraft from "@/database/ai-draft.model";
import AiUsageLog from "@/database/ai-usage-log.model";
import { getLlmProvider, getModelForTask } from "@/lib/ai/router";
import {
  retrieveSimilar,
  type RetrievedSource,
} from "@/lib/ai/rag/retrieve";
import { ANSWER_DRAFT_V3 } from "@/lib/ai/prompts/answer-draft.v3";
import {
  AI_CALL_TIMEOUT_MS,
  AI_DRAFT_MAX_CONTENT_CHARS,
  isAiEnabled,
} from "@/lib/ai/limits";
import {
  AI_CACHE_TTLS_SECONDS as CACHE_TTLS,
  exactCacheKey,
  setCachedDraftByQuestion,
  setExactCache,
  type CachedDraft,
} from "@/lib/ai/cache";
import { scrubPII, stripHtmlToText } from "@/lib/ai/guardrails/input";
import { scrubOutput } from "@/lib/ai/guardrails/output";
import { updateUsageLog } from "@/lib/ai/observability";
import type {
  ValidationGroundedness,
} from "@/lib/ai/validation-result";

/** Input for POST /api/ai/validate. The draft is Markdown, exactly
 *  as streamed; title/content are loaded from the database, never
 *  trusted from the client. */
export const ValidateDraftInputSchema = z.object({
  questionId: z.string().min(1),
  draft: z.string().min(1).max(20_000),
  usageLogId: z.string().min(1).optional(),
});

export const ValidationIssueSchema = z.object({
  claim: z.string().min(1),
  problem: z.string().min(1),
  fix: z.string().min(1),
});

/** The reviewer's verdict, enforced by the provider's structured
 *  output. "unavailable" is never produced by the model — it is the
 *  API-level fallback when validation itself could not run. */
export const ValidationResultSchema = z.object({
  verdict: z.enum(["ok", "needs-revision", "unverifiable"]),
  groundedness: z.enum(["grounded", "partial", "general-knowledge"]),
  issues: z.array(ValidationIssueSchema).max(10),
  revisedDraft: z.string().nullable(),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type ValidationVerdict = ValidationResult["verdict"] | "unavailable";

export interface ValidatedSource {
  n: number;
  questionId: string;
  title: string;
  score: number;
  answers: Array<{ answerId: string; snippet: string; upvotes: number }>;
}

export interface ValidateDraftResult {
  verdict: ValidationVerdict;
  groundedness: ValidationGroundedness;
  issues: Array<{ claim: string; problem: string; fix: string }>;
  revisedDraft: string | null;
  sources: ValidatedSource[];
}

/** The never-breaks-the-draft fallback, with whatever sources were
 *  already retrieved (usually none — the failure happened early). */
export function unavailableValidationResult(
  sources: ValidatedSource[] = []
): ValidateDraftResult {
  return {
    verdict: "unavailable",
    groundedness: "general-knowledge",
    issues: [],
    revisedDraft: null,
    sources,
  };
}

export const VALIDATION_SYSTEM = [
  "You are a strict technical reviewer checking an AI-generated answer draft against the community answers it was grounded in.",
  "Check: (a) every [n] citation actually supports the claim it is attached to — a citation to a source that does not say it is a failed citation;",
  "(b) any claim that contradicts a higher-upvoted community answer;",
  "(c) code that would not run, or wrong API usage;",
  "(d) claims with no source support that are not marked as general knowledge.",
  "Do not nitpick style or wording. Do not invent new claims the draft does not make.",
  "If the draft is sound, say so. If it needs fixes, list each issue and return the corrected FULL draft in Markdown, keeping the [n] citations and the short-answer-first format.",
  "If there are no usable sources (no retrieved answers at all), the draft is pure general knowledge: say so and do not invent a revision.",
  "Return ONLY valid JSON matching the required schema — no prose, no markdown fences.",
].join(" ");

export interface BuildValidationPromptInput {
  title: string;
  content: string;
  draft: string;
  sources: RetrievedSource[];
}

export function buildValidationPrompt(
  input: BuildValidationPromptInput
): string {
  const sourcesBlock =
    input.sources.length > 0
      ? input.sources
          .map((source, i) => {
            const answersBlock =
              source.answers && source.answers.length > 0
                ? `\nTop community answers:\n${source.answers
                    .map(
                      (answer) =>
                        `- (${answer.upvotes} upvotes) ${answer.content}`
                    )
                    .join("\n")}`
                : "\nTop community answers: none.";
            return `[${i + 1}] ${source.title}\nExcerpt: ${source.snippet}${answersBlock}`;
          })
          .join("\n\n")
      : "Retrieved sources: none.";
  return (
    `Question title: ${input.title}\n\nQuestion:\n${input.content}\n\n` +
    `Retrieved grounding (similar questions and their top community answers):\n${sourcesBlock}\n\n` +
    `Draft to review (Markdown):\n${input.draft}`
  );
}

export interface ValidateDraftParams {
  userId: Types.ObjectId;
  questionId: string;
  draft: string;
  usageLogId?: string;
}

/**
 * Validate a draft against the community answers retrieved for its
 * question. Returns the reviewer's verdict plus the grounding set
 * (with top answers) so the client can render richer Sources. Never
 * throws — any failure returns the "unavailable" fallback.
 */
export async function validateDraft(
  params: ValidateDraftParams
): Promise<ValidateDraftResult> {
  try {
    // Kill switch: with AI off, there is no provider call of any kind.
    if (!isAiEnabled()) {
      return unavailableValidationResult();
    }
    await connectToDatabase();
    const question = await Question.findById(params.questionId)
      .select("title content")
      .lean();
    if (!question) return unavailableValidationResult();
    const title = scrubPII(question.title);
    const content = scrubPII(
      stripHtmlToText(question.content).slice(0, AI_DRAFT_MAX_CONTENT_CHARS)
    );

    // Same grounding set the draft was generated from (retrieval is
    // best-effort — an empty list means the draft is general
    // knowledge, not a failure).
    const sources = await retrieveSimilar({
      text: `${title}\n${content}`,
      excludeQuestionId: params.questionId,
    });
    const validatedSources: ValidatedSource[] = sources.map(
      (source, i) => ({
        n: i + 1,
        questionId: source.questionId,
        title: source.title,
        score: Math.round(source.score * 1000) / 1000,
        answers: (source.answers ?? []).map((answer) => ({
          answerId: answer.answerId,
          snippet: answer.content,
          upvotes: answer.upvotes,
        })),
      })
    );

    const model = getModelForTask("answer-draft");
    const provider = getLlmProvider();
    const { object, usage } = await provider.generateObject({
      system: VALIDATION_SYSTEM,
      prompt: buildValidationPrompt({
        title,
        content,
        draft: scrubOutput(params.draft),
        sources,
      }),
      model,
      schema: ValidationResultSchema,
      // A revised draft is a full draft plus the issue list — larger
      // than the 2048-token draft cap.
      maxTokens: 3072,
      timeoutMs: AI_CALL_TIMEOUT_MS,
    });

    const revisedDraft =
      object.revisedDraft && object.revisedDraft.trim()
        ? scrubOutput(object.revisedDraft)
        : null;
    const result: ValidateDraftResult = {
      verdict: object.verdict,
      groundedness: object.groundedness,
      issues: object.issues,
      revisedDraft,
      sources: validatedSources,
    };

    // Persistence is best-effort and must never change the result
    // the client gets — a logging failure is not a validation failure.
    if (params.usageLogId) {
      try {
        await persistValidation(params, result, usage, validatedSources, {
          title,
          content,
        });
      } catch {
        // Deliberately silent — this failure is swallowed by design.
      }
    }
    return result;
  } catch (error) {
    console.error("AI validation failed, keeping original draft", error);
    return unavailableValidationResult();
  }
}

/**
 * Add the validation call's tokens to the draft's usage-log row, and
 * if a revised draft was produced, replace the stored draft and
 * refresh both caches with it — so the next identical question gets
 * the corrected draft, not the flawed one. Skips silently when the
 * log row or the draft row cannot be found.
 */
async function persistValidation(
  params: ValidateDraftParams,
  result: ValidateDraftResult,
  usage: { inputTokens: number; outputTokens: number },
  sources: ValidatedSource[],
  question: { title: string; content: string }
): Promise<void> {
  if (!params.usageLogId) return;
  const log = await AiUsageLog.findById(params.usageLogId);
  if (!log) return;
  await updateUsageLog(params.usageLogId, {
    inputTokens: log.inputTokens + usage.inputTokens,
    outputTokens: log.outputTokens + usage.outputTokens,
  });
  if (!result.revisedDraft) return;
  const draftRow = await AiDraft.findOne({
    userId: log.userId,
    questionId: params.questionId,
  }).sort({ createdAt: -1 });
  if (!draftRow) return;
  draftRow.content = result.revisedDraft;
  await draftRow.save();
  const cached: CachedDraft = {
    text: result.revisedDraft,
    sources: sources.map((source) => ({
      n: source.n,
      questionId: source.questionId,
      title: source.title,
      score: source.score,
    })),
    modelName: draftRow.modelName,
    promptId: ANSWER_DRAFT_V3.id,
    promptVersion: ANSWER_DRAFT_V3.version,
  };
  await setExactCache(
    exactCacheKey(
      ANSWER_DRAFT_V3.id,
      ANSWER_DRAFT_V3.version,
      `${params.questionId}\n${question.title}\n${question.content}`
    ),
    cached,
    CACHE_TTLS["answer-draft"]
  );
  await setCachedDraftByQuestion(params.questionId, cached);
}
