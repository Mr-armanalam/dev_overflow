/**
 * Pure empty-draft helpers, shared by the draft route, the answer form,
 * the model-check script and the tests. This module has NO server
 * imports (no Mongoose, no provider) so the client component can
 * import it — the same pattern as lib/ai/markdown.ts and
 * lib/ai/validation-result.ts.
 *
 * Background: a draft can come back empty on a cleanly-finished
 * stream — the model produced zero text. Two known causes are a
 * safety block (Gemini BLOCK_MEDIUM_AND_ABOVE, AI SDK finishReason
 * "content-filter") and a model that no longer serves the key
 * (gemini-2.5-flash is deprecated, shutdown Dec 1 2026; new keys get
 * a 404 naming gemini-3.8-flash). The route records the finish reason
 * in the usage log so the cause is visible instead of guessed.
 */
import type { CachedDraft } from "./cache";

/** Error code the draft route writes when a draft comes back empty. */
export function emptyDraftErrorCode(finishReason: string): string {
  const reason = finishReason.trim().toUpperCase() || "UNKNOWN";
  return `EMPTY_RESPONSE_${reason}`;
}

/** True when the empty draft was a safety/content-filter block. */
export function isSafetyEmptyDraft(
  errorCode: string | null | undefined
): boolean {
  return errorCode === "EMPTY_RESPONSE_CONTENT-FILTER";
}

/**
 * What the answer form shows for an empty draft. A safety block gets
 * its own message — regenerating the same question will not help, the
 * question needs rephrasing.
 */
export function emptyDraftMessage(
  errorCode: string | null | undefined
): string {
  if (isSafetyEmptyDraft(errorCode)) {
    return "The AI declined to answer this question — try rephrasing it.";
  }
  return "The AI returned an empty draft. Please try regenerating.";
}

/**
 * A cached draft is only servable when it actually contains text.
 * Empty drafts cached before PR #35 (which stopped storing them) are
 * poison: serving one repeats the empty draft instantly. Treat them
 * as a miss and let the caller delete the entry.
 */
export function isUsableCachedDraft(
  cached: CachedDraft | null | undefined
): cached is CachedDraft {
  return (
    cached !== null &&
    cached !== undefined &&
    cached.text.trim().length > 0
  );
}

/** One model probe result for the check-ai-model script. */
export interface ModelProbeOutcome {
  /** True when the model returned non-empty text. */
  nonEmpty: boolean;
  /** True when the call threw instead of returning. */
  errored: boolean;
}

/**
 * Exit code for `npm run check:ai-model`: 0 when any model answered
 * with text, 2 when every model errored, 1 otherwise (at least one
 * model answered cleanly but with empty text — the safety-block
 * shape). No outcomes at all is an error (2).
 */
export function modelCheckExitCode(
  outcomes: ModelProbeOutcome[]
): 0 | 1 | 2 {
  if (outcomes.length === 0) return 2;
  if (outcomes.some((o) => o.nonEmpty)) return 0;
  if (outcomes.every((o) => o.errored)) return 2;
  return 1;
}
