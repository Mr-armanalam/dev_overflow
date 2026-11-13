import { Schema, model, models, Document, Types } from "mongoose";

/**
 * One row per embedded chunk (design §5.2). The corpus is the
 * question title + body (one chunk per question, ~1,500 chars, split
 * on Markdown headings when longer) plus its top ≤3 answers with net
 * score ≥ 0 (one chunk per answer). Tag descriptions are not separate
 * chunks — the question chunk carries its tag names in the text.
 *
 * The Atlas vector search index itself is NOT created by this code:
 * on M0/M2/M5 it must be created in the Atlas UI from
 * docs/atlas-vector-index.json (see docs/rag-setup.md). Retrieval
 * degrades gracefully to "no sources" when the index does not exist
 * yet — see lib/ai/rag/retrieve.ts.
 */
export interface IQuestionEmbedding extends Document {
  questionId: Types.ObjectId;
  answerId?: Types.ObjectId;
  chunkText: string;
  /** text-embedding-004 output: exactly 768 dimensions. */
  embedding: number[];
  tags: string[];
  /** Upvote count of the source question/answer, used by the reranker. */
  upvotes: number;
  createdAt: Date;
}

const QuestionEmbeddingSchema = new Schema<IQuestionEmbedding>({
  questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
  answerId: { type: Schema.Types.ObjectId, ref: "Answer" },
  chunkText: { type: String, required: true },
  embedding: { type: [Number], required: true },
  tags: [{ type: String }],
  upvotes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Re-indexing a question replaces all its chunks at once.
QuestionEmbeddingSchema.index({ questionId: 1, answerId: 1 });
QuestionEmbeddingSchema.index({ createdAt: -1 });

const QuestionEmbedding =
  models.QuestionEmbedding ||
  model<IQuestionEmbedding>("QuestionEmbedding", QuestionEmbeddingSchema);

export default QuestionEmbedding;
