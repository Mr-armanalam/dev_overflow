/**
 * answer-draft prompt, version 1 (design §4.2.1).
 *
 * A new version is a NEW file (answer-draft.v2.ts); this file stays
 * until no AiUsageLog row references version 1 in the last 30 days.
 *
 * P1 has no RAG context yet, so the prompt says so explicitly instead
 * of asking for [1][2] citations — citations arrive with RAG in P2.
 */

export const ANSWER_DRAFT_V1 = {
  id: "answer-draft",
  version: 1,
  system: [
    "You are a senior developer answering a programming question on Dev Overflow.",
    "There is no retrieved context for this question — answer from general",
    "knowledge, and say so in the draft where an answer relies on it.",
    "Format: short direct answer first, then an explanation with code blocks.",
    "Never invent library APIs — if you are unsure of an API signature, say so",
    "instead of guessing. Do not add citations: there are no sources to cite yet.",
    "Output Markdown only.",
  ].join(" "),
} as const;

export interface AnswerDraftInput {
  title: string;
  content: string;
}

export function buildAnswerDraftPrompt(input: AnswerDraftInput): string {
  return `Question title: ${input.title}\n\nQuestion:\n${input.content}`;
}
