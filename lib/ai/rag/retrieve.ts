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
import Answer from "@/database/answer.model";
import Question from "@/database/question.model";
import QuestionEmbedding from "@/database/question-embedding.model";
import { getLlmProvider } from "@/lib/ai/router";
import { scrubPII, stripHtmlToText } from "@/lib/ai/guardrails/input";

export const RAG_VECTOR_INDEX_NAME = "question_embeddings_vector_index";
export const RAG_RETRIEVAL_TOP_K = 5;
const RAG_VECTOR_SEARCH_LIMIT = 12;
const RAG_VECTOR_SEARCH_CANDIDATES = 100;
/** Recency decays with a ~6-month half-life. */
const RAG_RECENCY_HALF_LIFE_DAYS = 180;
/** Answer content is truncated to ~800 chars per answer in the prompt. */
export const RAG_ANSWER_SNIPPET_CHARS = 800;

export interface RetrievedAnswer {
  answerId: string;
  /** Plain text, PII-scrubbed, truncated to ~800 chars. */
  content: string;
  upvotes: number;
}

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
  /**
   * The community's actual answers to this question, top 2 by upvote
   * count. Optional so older callers (similar route, MCP tools) keep
   * working — they ignore this field. Populated best-effort: an
   * answers failure never takes the question sources away.
   */
  answers?: RetrievedAnswer[];
}

/**
 * Answer content as it goes into a prompt: HTML stripped to plain
 * text, PII scrubbed like any prompt input, truncated to ~800 chars.
 * Pure — covered by lib/ai/rag/retrieve.test.ts.
 */
export function formatRetrievedAnswer(content: string): string {
  const text = scrubPII(stripHtmlToText(content));
  if (text.length <= RAG_ANSWER_SNIPPET_CHARS) return text;
  return `${text.slice(0, RAG_ANSWER_SNIPPET_CHARS).trimEnd()}…`;
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

    const top = [...bestByQuestion.values()]
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
    await attachTopAnswers(top);
    return top;
  } catch (error) {
    // Missing index, no embeddings yet, provider down — retrieval is
    // best-effort. Log once and return no sources; the caller drafts
    // from general knowledge instead of failing.
    console.error("RAG retrieval failed, continuing without sources", error);
    return [];
  }
}

/**
 * Grounding (v3): attach the top 2 answers per retrieved question,
 * ordered by upvote count descending, so drafts are generated from
 * the community's actual answers instead of question text alone.
 * Reranking stays question-signal only — answers never change which
 * questions are retrieved, only what the model reads about them.
 * Best-effort: an answers failure logs once and leaves the sources
 * without answers, instead of taking the questions away.
 */
async function attachTopAnswers(
  sources: RetrievedSource[]
): Promise<void> {
  if (sources.length === 0) return;
  try {
    await connectToDatabase();
    const answers = await Answer.find({
      question: { $in: sources.map((source) => source.questionId) },
    })
      .select("_id question content upvotes")
      .lean();
    const byQuestion = new Map<string, typeof answers>();
    for (const answer of answers) {
      const key = String(answer.question);
      const list = byQuestion.get(key) ?? [];
      list.push(answer);
      byQuestion.set(key, list);
    }
    for (const source of sources) {
      const list = byQuestion.get(source.questionId) ?? [];
      source.answers = list
        .sort((a, b) => b.upvotes.length - a.upvotes.length)
        .slice(0, 2)
        .map((answer) => ({
          answerId: String(answer._id),
          content: formatRetrievedAnswer(answer.content),
          upvotes: answer.upvotes.length,
        }));
    }
  } catch (error) {
    console.error(
      "RAG retrieval: could not load answers, continuing without them",
      error
    );
  }
}
