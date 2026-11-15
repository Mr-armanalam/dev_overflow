/**
 * Cost table for AiUsageLog.costUsd (design §9.1).
 *
 * APPROXIMATE list prices, prompts up to 200k tokens:
 * - gemini-3.5-flash-lite: $0.30 / 1M input tokens, $2.50 / 1M
 *   output tokens (paid tier; free tier is free of charge). The
 *   current router model — confirmed working on v1, 15 Nov 2026.
 * - gemini-3.8-flash: $0.75 / 1M input tokens, $3.75 / 1M output
 *   tokens (introductory rate through Dec 31 2026; doubles to
 *   $1.50 / $7.50 from Jan 1 2027) — kept only so historical usage
 *   logs still price correctly (it never served this key: v1beta
 *   503, v1 hang).
 * - gemini-2.5-flash: $0.30 / 1M input, $2.50 / 1M output — kept
 *   only so historical usage logs still price correctly (the model
 *   is deprecated, shutdown Dec 1 2026).
 * VERIFY against Google AI Studio pricing before quoting costs
 * anywhere, and update these numbers if Google changes them.
 */
export const AI_PRICING_USD_PER_1M_TOKENS: Record<string, {
  input: number;
  output: number;
}> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  // gemini-embedding-2: $0.20 / 1M tokens, input only
  // (embeddings have no output tokens). APPROXIMATE — verify
  // against Google AI Studio pricing before quoting costs anywhere.
  "gemini-embedding-2": { input: 0.2, output: 0 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = AI_PRICING_USD_PER_1M_TOKENS[model];
  if (!price) return 0;
  const cost =
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output;
  // 6 decimal places — costs here are fractions of a cent.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
