/**
 * Output guardrails (design §8.1, P3):
 * - Zod-parse structured outputs with ONE repair retry, then fail soft
 *   (the caller returns a 502 + logs the error — never a crash).
 * - Strip any secrets the model echoes back, reusing the PII-scrub
 *   patterns from lib/ai/guardrails/input.ts.
 *
 * The AI SDK's generateObject already validates against the Zod schema
 * (it throws NoObjectGeneratedError on a parse failure), so the repair
 * retry is a second call with an explicit "return only valid JSON"
 * instruction. Drafts are streaming text, not structured output, so
 * they are not covered here — see the per-chunk scrub on the stream
 * (lib/ai/client.ts) and the stored-draft scrub in /api/ai/draft.
 */
import { NoObjectGeneratedError } from "ai";
import { scrubPII } from "./input";

/** Strip emails, phone numbers and key/token-looking strings from
 *  model output before it is stored or returned. */
export function scrubOutput(text: string): string {
  return scrubPII(text);
}

/** Appended to the system prompt on the single repair retry. */
export const STRUCTURED_OUTPUT_REPAIR_INSTRUCTION =
  "Your previous response was not valid JSON matching the required schema. Return ONLY valid JSON that matches the schema exactly — no prose, no markdown fences, no explanation.";

/**
 * Run a structured-output call, retrying exactly once with a repair
 * instruction when the first attempt fails to produce a valid object.
 * Non-parse errors (auth, rate limits, provider 5xx) are rethrown
 * immediately — retrying those is the provider wrapper's job
 * (lib/ai/client.ts), not this helper's.
 */
export async function withStructuredOutputRepair<T>(
  run: (repair: boolean) => Promise<T>
): Promise<T> {
  try {
    return await run(false);
  } catch (error) {
    if (!isStructuredOutputError(error)) {
      throw error;
    }
    return run(true);
  }
}

function isStructuredOutputError(error: unknown): boolean {
  if (NoObjectGeneratedError.isInstance(error)) {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /json|parse|schema|object/i.test(message);
}
