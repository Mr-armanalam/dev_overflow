/**
 * Check whether the Gemini models actually answer with this key:
 *
 *   npm run check:ai-model
 *
 * Tests gemini-2.5-flash first, then gemini-3.8-flash (the model
 * Google's 404 names as the replacement), plus the gemini-embedding-2
 * call the RAG path needs. Prints per-model finishReason, text,
 * tokens and latency — never the key.
 *
 * Why this exists: drafts started coming back empty on a cleanly
 * finished stream. gemini-2.5-flash is deprecated (shutdown Dec 1
 * 2026, auto-routes to gemini-3.5-flash-lite after) and access is
 * limited to projects that actively used 2.5 before — a key created
 * recently gets `404 "This model models/gemini-2.5-flash is no longer
 * available to new users"`. A 404 normally surfaces as an error, not
 * a silent empty stream, so this script settles which side is broken:
 * the model/key or the prompt (safety block shows up as
 * finishReason "content-filter").
 *
 * Exit codes: 0 if either text model returns non-empty text, 1 if
 * both answer cleanly but empty (safety-block shape), 2 if both
 * error (or the key is missing). The embedding result is
 * informational and does not change the exit code.
 *
 * Timeout: `--timeout-ms <n>` sets the per-call timeout for the two
 * text probes (default 60_000). A diagnostic deserves a generous
 * window — the 15 s production timeout (AI_CALL_TIMEOUT_MS) already
 * proved too tight to tell a stall from slowness. Production is
 * untouched.
 *
 * Relative imports only: this runs under tsx outside Next.js.
 */
import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import { getLlmProvider } from "../lib/ai/router";
import {
  modelCheckExitCode,
  type ModelProbeOutcome,
} from "../lib/ai/empty-draft";

// dotenv/config loads `.env` only — the app's vars live in `.env.local`.
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const MODELS = ["gemini-2.5-flash", "gemini-3.8-flash"] as const;
const PROBE_PROMPT = "Reply with the single word OK and nothing else.";
const DEFAULT_TIMEOUT_MS = 60_000;

function parseTimeoutMs(argv: string[]): number {
  const index = argv.indexOf("--timeout-ms");
  if (index === -1) return DEFAULT_TIMEOUT_MS;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_TIMEOUT_MS;
}

async function main(): Promise<number> {
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "GEMINI_API_KEY is not set (check .env.local). Cannot test the models."
    );
    return 2;
  }

  const timeoutMs = parseTimeoutMs(process.argv.slice(2));
  const provider = getLlmProvider();
  const outcomes: ModelProbeOutcome[] = [];

  for (const model of MODELS) {
    try {
      const result = await provider.generate({
        system: "You are a test probe.",
        prompt: PROBE_PROMPT,
        model,
        maxTokens: 16,
        timeoutMs,
      });
      const text = result.text.trim();
      console.log(`\n${model}:`);
      console.log(`  finishReason: ${result.finishReason}`);
      console.log(`  text: ${text ? JSON.stringify(text) : "(empty)"}`);
      console.log(
        `  usage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`
      );
      console.log(`  latency: ${result.latencyMs} ms`);
      outcomes.push({ nonEmpty: text.length > 0, errored: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.log(`\n${model}:`);
      console.log(`  ERROR: ${message.slice(0, 500)}`);
      outcomes.push({ nonEmpty: false, errored: true });
    }
  }

  // Embedding check (RAG path): informational only.
  try {
    const { embeddings } = await provider.embedTexts(["hello"]);
    const dims = embeddings[0]?.length ?? 0;
    console.log(`\nembedding (gemini-embedding-2): ${dims}-d`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `\nembedding (gemini-embedding-2): ERROR: ${message.slice(0, 500)}`
    );
  }

  const code = modelCheckExitCode(outcomes);
  console.log(
    code === 0
      ? "\nResult: at least one model answers with text."
      : code === 1
        ? "\nResult: models answer but return empty text — check the finishReason above (content-filter = safety block)."
        : "\nResult: both models errored — check the error messages above."
  );
  return code;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(
      "Model check failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(2);
  });
