/**
 * Retrieval for RAG (design §5.2): `$vectorSearch` top-12 by cosine →
 * rerank `0.6·cosine + 0.25·(upvotes normalised) + 0.15·recency decay`
 * → top-5, deduplicated by question.
 *
 * Graceful degradation is a feature, not a gap: if the Atlas vector
 * index does not exist yet, or the embedding call fails, this returns
 * [] and the caller drafts without citations (the v2 prompt then says
 * "No similar questions found"). Retrieval must never break drafting
 * or the ask-question form.
 */
import type { PipelineStage, Types } from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import Question from "@/database/question.model";
import QuestionEmbedding from "@/database/question-embedding.model";
import { getLlmProvider } from "@/lib/ai/router";
import { scrubPII } from "@/lib/ai/guardrails/input";

export const RAG_VECTOR_INDEX_NAME = "question_embeddings_vector_index";
export const RAG_RETRIEVAL_TOP_K = 5;
const RAG_VECTOR_SEARCH_LIMIT = 12;
const RAG_VECTOR_SEARCH_CANDIDATES = 100;
/** Recency decays with a ~6-month half-life. */
const RAG_RECENCY_HALF_LIFE_DAYS = 180;

export interface RetrievedSource {
  questionId: string;
  title: string;
  /** First ~300 chars of the best-matching chunk. */
  snippet: string;
  /** Reranked score: 0.6·cosine + 0.25·upvotes + 0.15·recency. */
  score: number;
  cosine: number;
  upvotes: number;
  createdAt: Date;
}

function normaliseUpvotes(upvotes: number): number {
  // Saturating: 0 → 0, 10 → 0.5, 90 → 0.9. Upvotes must help, never dominate.
  return upvotes / (upvotes + 10);
}

function recencyDecay(createdAt: Date): number {
  const ageDays = Math.max(
    0,
    (Date.now() - createdAt.getTime()) / 86_400_000
  );
  return Math.exp(-ageDays / RAG_RECENCY_HALF_LIFE_DAYS);
}

export interface RetrieveSimilarInput {
  text: string;
  limit?: number;
  excludeQuestionId?: string;
}

export async function retrieveSimilar(
  input: RetrieveSimilarInput
): Promise<RetrievedSource[]> {
  const limit = input.limit ?? RAG_RETRIEVAL_TOP_K;
  try {
    await connectToDatabase();
    const provider = getLlmProvider();
    const { embeddings } = await provider.embedTexts([
      scrubPII(input.text),
    ]);
    const queryVector = embeddings[0];
    if (!queryVector || queryVector.length !== 768) {
      console.error("RAG retrieval: embedding has wrong dimensions");
      return [];
    }

    const pipeline = [
      {
        $vectorSearch: {
          index: RAG_VECTOR_INDEX_NAME,
          path: "embedding",
          queryVector,
          numCandidates: RAG_VECTOR_SEARCH_CANDIDATES,
          limit: RAG_VECTOR_SEARCH_LIMIT,
        },
      },
      {
        $project: {
          _id: 0,
          questionId: 1,
          chunkText: 1,
          upvotes: 1,
          createdAt: 1,
          cosine: { $meta: "vectorSearchScore" },
        },
      },
    ] as unknown as PipelineStage[];

    const hits = await QuestionEmbedding.aggregate(pipeline);
    if (!Array.isArray(hits) || hits.length === 0) return [];

    // Best chunk per question (a question can match via several chunks).
    const bestByQuestion = new Map<string, RetrievedSource>();
    for (const hit of hits as Array<{
      questionId: Types.ObjectId;
      chunkText: string;
      upvotes: number;
      createdAt: Date;
      cosine: number;
    }>) {
      const questionId = String(hit.questionId);
      if (
        input.excludeQuestionId &&
        questionId === input.excludeQuestionId
      ) {
        continue;
      }
      const existing = bestByQuestion.get(questionId);
      if (!existing || hit.cosine > existing.cosine) {
        bestByQuestion.set(questionId, {
          questionId,
          title: "",
          snippet: hit.chunkText.slice(0, 300),
          score: 0,
          cosine: hit.cosine,
          upvotes: hit.upvotes,
          createdAt: hit.createdAt,
        });
      }
    }
    if (bestByQuestion.size === 0) return [];

    const questions = await Question.find({
      _id: { $in: [...bestByQuestion.keys()] },
    })
      .select("_id title")
      .lean();
    const titles = new Map(
      questions.map((question) => [String(question._id), question.title])
    );

    return [...bestByQuestion.values()]
      .filter((source) => titles.has(source.questionId))
      .map((source) => ({
        ...source,
        title: titles.get(source.questionId) ?? "",
        score:
          0.6 * source.cosine +
          0.25 * normaliseUpvotes(source.upvotes) +
          0.15 * recencyDecay(source.createdAt),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (error) {
    // Missing index, no embeddings yet, provider down — retrieval is
    // best-effort. Log once and return no sources; the caller drafts
    // from general knowledge instead of failing.
    console.error("RAG retrieval failed, continuing without sources", error);
    return [];
  }
}
