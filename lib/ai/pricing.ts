/**
 * Cost table for AiUsageLog.costUsd (design §9.1).
 *
 * APPROXIMATE list prices for gemini-2.5-flash, prompts up to 200k
 * tokens: $0.30 / 1M input tokens, $2.50 / 1M output tokens.
 * VERIFY against Google AI Studio pricing before quoting costs
 * anywhere, and update these numbers if Google changes them.
 */
export const AI_PRICING_USD_PER_1M_TOKENS: Record<string, {
  input: number;
  output: number;
}> = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  // text-embedding-004: $0.00002 / 1K tokens = $0.02 / 1M tokens, input
  // only (embeddings have no output tokens). APPROXIMATE — verify
  // against Google AI Studio pricing before quoting costs anywhere.
  "text-embedding-004": { input: 0.02, output: 0 },
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
