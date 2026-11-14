/**
 * Indexing pipeline (design §5.3). `indexQuestion` / `indexAnswer` /
 * `deleteChunksFor` — called fire-and-forget from the existing server
 * actions after a successful write, never blocking the user's submit.
 *
 * These functions NEVER throw: an indexing failure is logged to
 * AiUsageLog (task "embedding", status "error") and reported in the
 * return value, so a Gemini/Atlas outage can never break asking or
 * answering. The backfill script relies on the return value to count
 * failures.
 */
import type { Types } from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import Question from "@/database/question.model";
import Answer from "@/database/answer.model";
import Tag from "@/database/tag.model";
import QuestionEmbedding from "@/database/question-embedding.model";
import { getLlmProvider } from "@/lib/ai/router";
import { createUsageLog } from "@/lib/ai/observability";
import { scrubPII } from "@/lib/ai/guardrails/input";
import {
  buildAnswerChunkTexts,
  buildQuestionChunkTexts,
} from "./chunking";

export interface IndexResult {
  ok: boolean;
  /** Chunks written (0 on failure, or when there was nothing to embed). */
  chunks: number;
  error?: string;
}

async function logIndexFailure(
  userId: Types.ObjectId | undefined,
  questionId: string,
  error: unknown
): Promise<void> {
  if (!userId) return;
  try {
    await createUsageLog({
      userId,
      promptId: "embedding",
      promptVersion: 1,
      modelName: "text-embedding-004",
      task: "embedding",
      status: "error",
      errorCode: `INDEX_ERROR question=${questionId} ${
        error instanceof Error
          ? error.message.slice(0, 150)
          : "unknown error"
      }`,
    });
  } catch (logError) {
    // Logging must never break indexing callers either.
    console.error("Failed to log embedding index failure", logError);
  }
}

interface ChunkToWrite {
  questionId: Types.ObjectId;
  answerId?: Types.ObjectId;
  chunkText: string;
  tags: string[];
  upvotes: number;
}

/**
 * (Re-)embed a question and its top ≤3 answers (net score ≥ 0).
 * Existing chunks for the question are deleted first, so re-indexing
 * is idempotent — the backfill script can safely run twice.
 */
export async function indexQuestion(
  questionId: Types.ObjectId | string,
  userId?: Types.ObjectId
): Promise<IndexResult> {
  try {
    await connectToDatabase();
    const question = await Question.findById(questionId).populate({
      path: "tags",
      model: Tag,
      select: "name",
    });
    if (!question) {
      return { ok: false, chunks: 0, error: "Question not found" };
    }
    const tagNames: string[] = (question.tags ?? []).map(
      (tag: { name: string }) => tag.name
    );

    // Top answers by upvotes, net score (upvotes − downvotes) ≥ 0.
    const answers = await Answer.find({ question: question._id })
      .sort({ upvotes: -1 })
      .limit(10);
    const topAnswers = answers
      .filter(
        (answer) => answer.upvotes.length - answer.downvotes.length >= 0
      )
      .slice(0, 3);

    const chunks: ChunkToWrite[] = [];
    for (const text of buildQuestionChunkTexts(
      question.title,
      question.content,
      tagNames
    )) {
      chunks.push({
        questionId: question._id,
        chunkText: scrubPII(text),
        tags: tagNames,
        upvotes: question.upvotes.length,
      });
    }
    for (const answer of topAnswers) {
      for (const text of buildAnswerChunkTexts(answer.content)) {
        chunks.push({
          questionId: question._id,
          answerId: answer._id,
          chunkText: scrubPII(text),
          tags: tagNames,
          upvotes: answer.upvotes.length,
        });
      }
    }
    if (chunks.length === 0) {
      await QuestionEmbedding.deleteMany({ questionId: question._id });
      return { ok: true, chunks: 0 };
    }

    const provider = getLlmProvider();
    const { embeddings } = await provider.embedTexts(
      chunks.map((chunk) => chunk.chunkText)
    );
    if (embeddings.length !== chunks.length) {
      throw new Error(
        `Embedding count mismatch: got ${embeddings.length} for ${chunks.length} chunks`
      );
    }

    await QuestionEmbedding.deleteMany({ questionId: question._id });
    await QuestionEmbedding.insertMany(
      chunks.map((chunk, i) => ({
        questionId: chunk.questionId,
        answerId: chunk.answerId,
        chunkText: chunk.chunkText,
        embedding: embeddings[i],
        tags: chunk.tags,
        upvotes: chunk.upvotes,
      }))
    );
    return { ok: true, chunks: chunks.length };
  } catch (error) {
    console.error(
      `Failed to index question ${String(questionId)} for RAG`,
      error
    );
    await logIndexFailure(userId, String(questionId), error);
    return {
      ok: false,
      chunks: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * (Re-)embed one answer. Implemented as a full re-index of its
 * question: a new or newly-voted answer can change which ≤3 answers
 * belong in the corpus, so the question's chunks are rebuilt whole.
 */
export async function indexAnswer(
  answerId: Types.ObjectId | string,
  userId?: Types.ObjectId
): Promise<IndexResult> {
  try {
    await connectToDatabase();
    const answer = await Answer.findById(answerId);
    if (!answer) {
      return { ok: false, chunks: 0, error: "Answer not found" };
    }
    return indexQuestion(answer.question, userId ?? answer.author);
  } catch (error) {
    console.error(
      `Failed to index answer ${String(answerId)} for RAG`,
      error
    );
    return {
      ok: false,
      chunks: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete every chunk for a question (all its chunks, including its
 * answers') or for a single answer (only that answer's chunk).
 * Never throws — callers fire-and-forget this after a delete.
 */
export async function deleteChunksFor(
  id: Types.ObjectId | string
): Promise<void> {
  try {
    await connectToDatabase();
    await QuestionEmbedding.deleteMany({
      $or: [{ questionId: id }, { answerId: id }],
    });
  } catch (error) {
    console.error(`Failed to delete RAG chunks for ${String(id)}`, error);
  }
}
