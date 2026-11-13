/**
 * Backfill RAG embeddings for every existing question (design §5.3).
 * Run once manually after creating the Atlas vector index:
 *
 *   npm run backfill:embeddings
 *
 * Needs the same server-only env vars as the app (.env.local:
 * MONGODB_URL, GEMINI_API_KEY). Re-indexing is idempotent — running
 * it twice is safe — so just re-run it if it exits non-zero.
 *
 * No cron / Vercel Cron route is added in P2 (deliberate): this is a
 * one-off script, run by hand. New questions/answers are indexed on
 * write by lib/ai/rag/index.ts, so the backfill never needs repeating
 * unless the corpus is wiped.
 *
 * Relative imports only: this runs under tsx outside Next.js.
 */
import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import mongoose, { type Types } from "mongoose";
import { connectToDatabase } from "../lib/mongoose";
import Question from "../database/question.model";
import { indexQuestion } from "../lib/ai/rag/index";

// dotenv/config loads `.env` only — the app's vars live in `.env.local`.
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const DELAY_MS_BETWEEN_QUESTIONS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!process.env.MONGODB_URL) {
    throw new Error("MONGODB_URL is not set (check .env.local)");
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set (check .env.local)");
  }

  await connectToDatabase();
  const questions = await Question.find({})
    .select("_id author")
    .sort({ createdAt: 1 })
    .lean<{ _id: Types.ObjectId; author: Types.ObjectId }[]>();
  console.log(`Backfilling embeddings for ${questions.length} questions…`);

  let ok = 0;
  let failed = 0;
  let chunks = 0;
  const failures: string[] = [];

  for (const [i, question] of questions.entries()) {
    const result = await indexQuestion(question._id, question.author);
    if (result.ok) {
      ok += 1;
      chunks += result.chunks;
      console.log(
        `  [${i + 1}/${questions.length}] ${String(question._id)}: ${result.chunks} chunks`
      );
    } else {
      failed += 1;
      failures.push(`${String(question._id)}: ${result.error ?? "unknown"}`);
      console.error(
        `  [${i + 1}/${questions.length}] ${String(question._id)}: FAILED — ${result.error ?? "unknown"}`
      );
    }
    if (i < questions.length - 1) await sleep(DELAY_MS_BETWEEN_QUESTIONS);
  }

  console.log(
    `\nDone: ${ok} indexed, ${failed} failed, ${chunks} chunks written.`
  );
  if (failures.length > 0) {
    console.log("Failures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    console.log("Re-run the script — re-indexing is idempotent.");
  }
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("Backfill failed:", error);
  try {
    await mongoose.disconnect();
  } catch {
    // Ignore disconnect errors on the failure path.
  }
  process.exit(1);
});
