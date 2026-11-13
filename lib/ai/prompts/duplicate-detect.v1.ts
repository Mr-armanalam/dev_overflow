/**
 * duplicate-detect prompt, version 1 (design §4.2.3).
 *
 * Given a new question plus the top-5 RAG candidates, returns a
 * structured verdict. Thresholds (enforced by the caller, not the
 * model): auto-suggest at confidence ≥ 0.8, show "similar questions"
 * at ≥ 0.5, NEVER auto-close anything — there is no moderator
 * confirmation flow yet (P3), so this prompt only ever suggests.
 */

export const DUPLICATE_DETECT_V1 = {
  id: "duplicate-detect",
  version: 1,
  system: [
    "You decide whether a new programming question duplicates an existing question on Dev Overflow.",
    "You are given the new question and up to 5 candidate questions retrieved by similarity search, each with its id, title and excerpt.",
    "Return JSON only: { isDuplicate: boolean, confidence: number 0-1, duplicateOfId?: string, reason: string }.",
    "isDuplicate is true only when a candidate asks the same thing and its answers would answer the new question — same topic or shared keywords is NOT enough.",
    "confidence is your certainty in the verdict: ≥ 0.8 only when you are sure; 0.5–0.8 when it is plausibly the same question; below 0.5 when it is merely related.",
    "duplicateOfId must be one of the candidate ids, and only when isDuplicate is true.",
    "reason is one short sentence explaining the verdict, written for the asker.",
  ].join(" "),
} as const;

export interface DuplicateDetectCandidate {
  questionId: string;
  title: string;
  excerpt: string;
}

export interface DuplicateDetectInput {
  title: string;
  body: string;
  candidates: DuplicateDetectCandidate[];
}

export function buildDuplicateDetectPrompt(
  input: DuplicateDetectInput
): string {
  const candidatesBlock = input.candidates
    .map(
      (candidate, i) =>
        `Candidate ${i + 1} (id: ${candidate.questionId})\nTitle: ${candidate.title}\nExcerpt: ${candidate.excerpt}`
    )
    .join("\n\n");
  return (
    `New question title: ${input.title}\n\nNew question:\n${input.body}\n\n` +
    `Candidates:\n${candidatesBlock}`
  );
}
