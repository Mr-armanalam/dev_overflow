/**
 * Eval harness for the AI answer-draft pipeline (design §9.2).
 *
 * Run: `npm run eval:ai [-- --limit N] [-- --id eval-01] [-- --out path]`
 *
 * For each golden pair in evals/golden.json it runs the CURRENT
 * answer-draft pipeline (same retrieval + answer-draft v2 prompt as
 * POST /api/ai/draft, non-streaming) and scores:
 *  (a) faithfulness — judge model (same Gemini flash via lib/ai):
 *      are the answer's claims supported by the retrieved sources,
 *      or correctly marked as general knowledge? Do they cover the
 *      pair's expectedPoints?
 *  (b) citation precision — [n] markers that reference a retrieved
 *      source AND whose excerpt the judge found relevant, over all
 *      [n] markers. No markers at all scores 1 when nothing was
 *      retrieved, 0 when sources were retrieved but never cited.
 *  (c) hallucination check — fenced ts/js code blocks are syntax-
 *      checked per snippet (ts.transpileModule). Syntax only: it
 *      cannot catch wrong-but-parseable code or invented APIs.
 *  (d) latency + cost per pair (measured locally, via
 *      lib/ai/pricing.ts — not written to AiUsageLog; eval runs are
 *      offline runs, not user calls).
 *
 * Exit code: 0 when faithfulness >= 0.8 AND citation precision >=
 * 0.7 (design §9.2), 1 when either threshold fails (failed pairs are
 * listed), 2 when the run cannot start at all (missing env vars).
 * No prompt or model change merges without this script passing.
 *
 * LIMITATIONS (documented, not hidden):
 * - The judge is the same flash model that wrote the draft
 *   (self-judging bias). A stronger judge is future work.
 * - The code check is syntax-only; semantic/runtime correctness is
 *   not checked.
 * - The run needs a real MongoDB (with the Atlas vector index +
 *   embeddings) and a Gemini key — it cannot run in the sandbox.
 *
 * Relative imports only: this runs under tsx outside Next.js
 * (same pattern as scripts/backfill-embeddings.ts).
 */
import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import ts from "typescript";
import { z } from "zod";
import { connectToDatabase } from "../lib/mongoose";
import { retrieveSimilar } from "../lib/ai/rag/retrieve";
import {
  ANSWER_DRAFT_V2,
  buildAnswerDraftPrompt,
} from "../lib/ai/prompts/answer-draft.v2";
import { getLlmProvider, getModelForTask } from "../lib/ai/router";
import { scrubPII } from "../lib/ai/guardrails/input";
import { estimateCostUsd } from "../lib/ai/pricing";

// dotenv/config loads `.env` only — the app's vars live in `.env.local`.
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const FAITHFULNESS_THRESHOLD = 0.8;
const CITATION_PRECISION_THRESHOLD = 0.7;

interface GoldenPair {
  id: string;
  question: string;
  expectedPoints: string[];
}

interface GoldenFile {
  version: number;
  pairs: GoldenPair[];
}

interface PairResult {
  id: string;
  question: string;
  faithfulness: number;
  citationPrecision: number;
  hallucinationPass: boolean;
  hallucinationFailures: string[];
  latencyMs: number;
  costUsd: number;
  sourcesRetrieved: number;
  citationsFound: number;
  unsupportedClaims: string[];
  answerPreview: string;
}

const JudgeSchema = z.object({
  /** 0–1: claims supported by the sources / marked general knowledge. */
  faithfulness: z.number().min(0).max(1),
  /** Citation numbers whose excerpt does NOT support the answer. */
  irrelevantCitationNumbers: z.array(z.number().int()),
  /** Claims in the answer that no source supports and that are not
   *  marked as general knowledge. */
  unsupportedClaims: z.array(z.string()),
  notes: z.string(),
});

function parseArgs(argv: string[]): {
  limit?: number;
  onlyId?: string;
  outPath?: string;
} {
  const result: { limit?: number; onlyId?: string; outPath?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--limit" && argv[i + 1]) {
      result.limit = Number.parseInt(argv[i + 1] as string, 10);
      i += 1;
    } else if (argv[i] === "--id" && argv[i + 1]) {
      result.onlyId = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--out" && argv[i + 1]) {
      result.outPath = argv[i + 1];
      i += 1;
    }
  }
  return result;
}

/** Extract fenced code blocks: { language, code }. */
function extractCodeBlocks(markdown: string): Array<{
  language: string;
  code: string;
}> {
  const blocks: Array<{ language: string; code: string }> = [];
  const fenceRe = /```([A-Za-z0-9_+-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(markdown)) !== null) {
    blocks.push({
      language: (match[1] ?? "").toLowerCase(),
      code: match[2] ?? "",
    });
  }
  return blocks;
}

const CHECKABLE_LANGUAGES: Record<string, { fileName: string; jsx: boolean }> = {
  ts: { fileName: "snippet.ts", jsx: false },
  typescript: { fileName: "snippet.ts", jsx: false },
  tsx: { fileName: "snippet.tsx", jsx: true },
  js: { fileName: "snippet.js", jsx: false },
  javascript: { fileName: "snippet.js", jsx: false },
  jsx: { fileName: "snippet.jsx", jsx: true },
};

/**
 * Syntax-check one fenced block. Returns an error string, or null
 * when the block parses (or its language is not checkable — other
 * languages are skipped, not failed).
 */
function checkCodeBlock(block: { language: string; code: string }): string | null {
  const checkable = CHECKABLE_LANGUAGES[block.language];
  if (!checkable || !block.code.trim()) {
    return null;
  }
  const { diagnostics } = ts.transpileModule(block.code, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: checkable.jsx ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None,
    },
    fileName: checkable.fileName,
  });
  const errors = (diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  if (errors.length === 0) {
    return null;
  }
  return errors
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
    .slice(0, 3)
    .join("; ");
}

function extractCitationNumbers(markdown: string): number[] {
  const numbers = new Set<number>();
  const re = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    numbers.add(Number.parseInt(match[1] as string, 10));
  }
  return [...numbers];
}

async function main(): Promise<number> {
  if (!process.env.MONGODB_URL) {
    console.error(
      "ERROR: MONGODB_URL is not set. Copy .env.example to .env.local and fill in MONGODB_URL (and GEMINI_API_KEY) first."
    );
    return 2;
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "ERROR: GEMINI_API_KEY is not set. Copy .env.example to .env.local and fill in GEMINI_API_KEY first."
    );
    return 2;
  }

  const args = parseArgs(process.argv.slice(2));
  const goldenPath = path.join(process.cwd(), "evals", "golden.json");
  if (!fs.existsSync(goldenPath)) {
    console.error(`ERROR: golden set not found at ${goldenPath}`);
    return 2;
  }
  const golden = JSON.parse(
    fs.readFileSync(goldenPath, "utf8")
  ) as GoldenFile;
  let pairs = golden.pairs;
  if (args.onlyId) {
    pairs = pairs.filter((p) => p.id === args.onlyId);
    if (pairs.length === 0) {
      console.error(`ERROR: no golden pair with id "${args.onlyId}"`);
      return 2;
    }
  }
  if (args.limit && Number.isFinite(args.limit) && args.limit > 0) {
    pairs = pairs.slice(0, args.limit);
  }

  const model = getModelForTask("answer-draft");
  const provider = getLlmProvider();
  const startedAtAll = Date.now();
  const results: PairResult[] = [];

  await connectToDatabase();

  for (const pair of pairs) {
    const pairStartedAt = Date.now();
    console.log(`\n--- ${pair.id}: ${pair.question}`);
    try {
      // Same retrieval + prompt as POST /api/ai/draft (P2), minus
      // streaming: the draft route streams; the eval needs the full
      // text, so it calls provider.generate with the same inputs.
      const questionText = scrubPII(pair.question);
      const sources = await retrieveSimilar({ text: questionText });
      const context = sources.map((source, i) => ({
        index: i + 1,
        questionId: source.questionId,
        title: source.title,
        excerpt: scrubPII(source.snippet),
      }));
      const draft = await provider.generate({
        system: ANSWER_DRAFT_V2.system,
        prompt: buildAnswerDraftPrompt({
          title: questionText,
          content: questionText,
          context,
        }),
        model,
        maxTokens: 2048,
      });

      // Judge call (same flash model — self-judging bias, documented).
      const judge = await provider.generateObject({
        system: [
          "You are a strict evaluator of programming answers.",
          "Score faithfulness 0-1: how many of the answer's factual claims are supported by the retrieved source excerpts, or are correctly marked as general knowledge? Also check the answer covers the expected points.",
          "List citation numbers whose source excerpt does NOT support the answer or is irrelevant to the question.",
          "List factual claims the answer makes that no source supports and that are not marked as general knowledge.",
          "Be strict: a claim that contradicts a source, or an invented API, scores low.",
        ].join(" "),
        prompt: [
          `Question: ${pair.question}`,
          `Expected points a good answer must cover:\n${pair.expectedPoints.map((p) => `- ${p}`).join("\n")}`,
          `Retrieved sources:\n${context.length > 0 ? context.map((c) => `[${c.index}] ${c.title}: ${c.excerpt}`).join("\n\n") : "(none retrieved)"}`,
          `Answer to evaluate:\n${draft.text}`,
        ].join("\n\n"),
        model,
        schema: JudgeSchema,
        maxTokens: 1024,
      });

      // Citation precision: cited markers that are valid AND relevant.
      const cited = extractCitationNumbers(draft.text);
      let citationPrecision: number;
      if (cited.length === 0) {
        citationPrecision = sources.length === 0 ? 1 : 0;
      } else {
        const irrelevant = new Set(judge.object.irrelevantCitationNumbers);
        const good = cited.filter(
          (n) => n >= 1 && n <= sources.length && !irrelevant.has(n)
        );
        citationPrecision = good.length / cited.length;
      }

      // Hallucination check: syntax-check fenced code blocks.
      const hallucinationFailures: string[] = [];
      for (const block of extractCodeBlocks(draft.text)) {
        const failure = checkCodeBlock(block);
        if (failure) {
          hallucinationFailures.push(
            `[${block.language || "plain"}] ${failure}`
          );
        }
      }

      const costUsd =
        estimateCostUsd(
          model,
          draft.usage.inputTokens,
          draft.usage.outputTokens
        ) +
        estimateCostUsd(
          model,
          judge.usage.inputTokens,
          judge.usage.outputTokens
        );

      const result: PairResult = {
        id: pair.id,
        question: pair.question,
        faithfulness: Math.round(judge.object.faithfulness * 1000) / 1000,
        citationPrecision: Math.round(citationPrecision * 1000) / 1000,
        hallucinationPass: hallucinationFailures.length === 0,
        hallucinationFailures,
        latencyMs: Date.now() - pairStartedAt,
        costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
        sourcesRetrieved: sources.length,
        citationsFound: cited.length,
        unsupportedClaims: judge.object.unsupportedClaims,
        answerPreview: draft.text.slice(0, 200),
      };
      results.push(result);
      console.log(
        `  faithfulness=${result.faithfulness} citationPrecision=${result.citationPrecision} ` +
          `code=${result.hallucinationPass ? "pass" : "FAIL"} ` +
          `latency=${result.latencyMs}ms cost=$${result.costUsd}`
      );
      if (result.unsupportedClaims.length > 0) {
        console.log(
          `  unsupported: ${result.unsupportedClaims.slice(0, 3).join(" | ")}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR: ${message}`);
      results.push({
        id: pair.id,
        question: pair.question,
        faithfulness: 0,
        citationPrecision: 0,
        hallucinationPass: false,
        hallucinationFailures: [`eval run failed: ${message}`],
        latencyMs: Date.now() - pairStartedAt,
        costUsd: 0,
        sourcesRetrieved: 0,
        citationsFound: 0,
        unsupportedClaims: [],
        answerPreview: "",
      });
    }
  }

  const n = results.length;
  const mean = (values: number[]): number =>
    n === 0 ? 0 : values.reduce((a, b) => a + b, 0) / n;
  const meanFaithfulness = mean(results.map((r) => r.faithfulness));
  const meanCitationPrecision = mean(
    results.map((r) => r.citationPrecision)
  );
  const hallucinationPassRate = mean(
    results.map((r) => (r.hallucinationPass ? 1 : 0))
  );
  const meanLatencyMs = mean(results.map((r) => r.latencyMs));
  const totalCostUsd = results.reduce((a, r) => a + r.costUsd, 0);

  const failed = results.filter(
    (r) =>
      r.faithfulness < FAITHFULNESS_THRESHOLD ||
      r.citationPrecision < CITATION_PRECISION_THRESHOLD ||
      !r.hallucinationPass
  );

  console.log("\n================ EVAL SUMMARY ================");
  console.log(`pairs: ${n} (in ${Date.now() - startedAtAll}ms total)`);
  console.log(
    `mean faithfulness: ${meanFaithfulness.toFixed(3)} (threshold >= ${FAITHFULNESS_THRESHOLD})`
  );
  console.log(
    `mean citation precision: ${meanCitationPrecision.toFixed(3)} (threshold >= ${CITATION_PRECISION_THRESHOLD})`
  );
  console.log(
    `code syntax pass rate: ${(hallucinationPassRate * 100).toFixed(0)}%`
  );
  console.log(`mean latency: ${Math.round(meanLatencyMs)}ms/pair`);
  console.log(`total cost: $${totalCostUsd.toFixed(6)} (approximate)`);
  if (failed.length > 0) {
    console.log(`\nFAILED PAIRS (${failed.length}):`);
    for (const r of failed) {
      console.log(
        `  ${r.id}: faithfulness=${r.faithfulness} citationPrecision=${r.citationPrecision} code=${r.hallucinationPass ? "pass" : "FAIL"}`
      );
      for (const f of r.hallucinationFailures) console.log(`    code: ${f}`);
      for (const c of r.unsupportedClaims.slice(0, 3)) {
        console.log(`    unsupported: ${c}`);
      }
    }
  }

  if (args.outPath) {
    const report = {
      ranAt: new Date().toISOString(),
      model,
      promptId: ANSWER_DRAFT_V2.id,
      promptVersion: ANSWER_DRAFT_V2.version,
      thresholds: {
        faithfulness: FAITHFULNESS_THRESHOLD,
        citationPrecision: CITATION_PRECISION_THRESHOLD,
      },
      summary: {
        pairs: n,
        meanFaithfulness,
        meanCitationPrecision,
        hallucinationPassRate,
        meanLatencyMs,
        totalCostUsd,
      },
      passed:
        meanFaithfulness >= FAITHFULNESS_THRESHOLD &&
        meanCitationPrecision >= CITATION_PRECISION_THRESHOLD,
      results,
    };
    fs.writeFileSync(args.outPath, JSON.stringify(report, null, 2));
    console.log(`\nFull report written to ${args.outPath}`);
  }

  const passed =
    meanFaithfulness >= FAITHFULNESS_THRESHOLD &&
    meanCitationPrecision >= CITATION_PRECISION_THRESHOLD;
  console.log(passed ? "\nEVAL PASSED" : "\nEVAL FAILED");
  return passed ? 0 : 1;
}

main()
  .then(async (code) => {
    await mongoose.disconnect().catch(() => undefined);
    process.exit(code);
  })
  .catch((error) => {
    // Startup failure (bad import, DB connect failure): say so
    // plainly instead of dumping a stack as the only output.
    console.error(
      `ERROR: eval run could not start: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(2);
  });
