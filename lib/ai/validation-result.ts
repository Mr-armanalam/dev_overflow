/**
 * Pure validation-result helpers, shared by the answer form and the
 * tests. This module has NO server imports (no Mongoose, no provider)
 * so the client component can import it — the same pattern as
 * lib/ai/markdown.ts.
 */

/** How well the draft is grounded in retrieved community answers. */
export type ValidationGroundedness =
  | "grounded"
  | "partial"
  | "general-knowledge";

/** The part of a validation result the answer form acts on. */
export interface ValidationOutcome {
  revisedDraft: string | null;
  groundedness: ValidationGroundedness;
  issuesFixed: number;
}

export interface ApplyValidationResult {
  /** The Markdown the user now sees (revised, or the original). */
  markdown: string;
  /** "Self-check refined this draft — N issues fixed." or null. */
  note: string | null;
  groundedness: ValidationGroundedness;
}

/**
 * Merge a validation outcome into the draft the user sees. A revised
 * draft replaces the original; an unavailable/failed validation (no
 * revised draft) keeps the original silently. Covered by
 * lib/ai/validate.test.ts.
 */
export function applyValidationResult(
  currentMarkdown: string,
  outcome: ValidationOutcome
): ApplyValidationResult {
  const revised = outcome.revisedDraft?.trim()
    ? outcome.revisedDraft
    : null;
  if (revised) {
    const count = outcome.issuesFixed;
    return {
      markdown: revised,
      note: `Self-check refined this draft — ${count} issue${
        count === 1 ? "" : "s"
      } fixed.`,
      groundedness: outcome.groundedness,
    };
  }
  return {
    markdown: currentMarkdown,
    note: null,
    groundedness: outcome.groundedness,
  };
}

/** Badge text for the grounding state shown above the draft. */
export function groundednessLabel(
  groundedness: ValidationGroundedness
): string {
  switch (groundedness) {
    case "grounded":
      return "Grounded in community answers";
    case "partial":
      return "Partly grounded in community answers";
    case "general-knowledge":
      return "General knowledge — no matching community answers";
  }
}
