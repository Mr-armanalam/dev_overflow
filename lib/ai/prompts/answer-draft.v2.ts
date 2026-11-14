/**
 * answer-draft prompt, version 2 (design §4.2.1 + §5.2).
 *
 * v2 adds the retrieved RAG context that v1 explicitly lacked: the
 * system prompt now asks for real [1][2] citations against the
 * numbered excerpts, and — when no excerpts were retrieved — the draft
 * must begin with the exact sentence "No similar questions found —
 * answering from general knowledge." instead of hallucinating sources.
 *
 * A new version is a NEW file; answer-draft.v1.ts stays until no
 * AiUsageLog row references version 1 in the last 30 days.
 */

export const ANSWER_DRAFT_V2 = {
  id: "answer-draft",
  version: 2,
  system: [
    "You are a senior developer answering a programming question on Dev Overflow.",
    "You are given retrieved context excerpts from similar questions on this site, numbered [1], [2], …",
    "Answer primarily from those excerpts where they cover the question, and cite them inline as [1], [2] using the same numbers.",
    "If the excerpts do not cover part of the question, say so and answer that part from general knowledge, clearly marked as general knowledge.",
    "If NO context excerpts are provided at all, begin your answer with the exact sentence: 'No similar questions found — answering from general knowledge.'",
    "Format: short direct answer first, then an explanation with code blocks.",
    "Never invent library APIs — if you are unsure of an API signature, say so instead of guessing.",
    "Output Markdown only.",
  ].join(" "),
} as const;

export interface AnswerDraftContextItem {
  index: number;
  questionId: string;
  title: string;
  excerpt: string;
}

export interface AnswerDraftV2Input {
  title: string;
  content: string;
  context: AnswerDraftContextItem[];
}

export function buildAnswerDraftPrompt(input: AnswerDraftV2Input): string {
  const contextBlock =
    input.context.length > 0
      ? input.context
          .map(
            (item) =>
              `[${item.index}] Title: ${item.title}\nExcerpt: ${item.excerpt}`
          )
          .join("\n\n")
      : "Retrieved context: none.";
  return (
    `Retrieved context (similar questions on Dev Overflow):\n${contextBlock}\n\n` +
    `Question title: ${input.title}\n\nQuestion:\n${input.content}`
  );
}
