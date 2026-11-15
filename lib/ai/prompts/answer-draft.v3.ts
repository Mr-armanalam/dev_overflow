/**
 * answer-draft prompt, version 3 (answer-grounded drafts).
 *
 * v3 fixes what v2 could not: v2 grounded the draft in similar
 * QUESTION text only — the model never saw the community's actual
 * answers, so a draft could only point at questions that might
 * contain an answer. v3 gives the model the top 2 answers per
 * retrieved question (highest-upvoted first) and asks it to answer
 * primarily from them, with [n] citations that mean "this answer
 * supports this claim".
 *
 * A new version is a NEW file; answer-draft.v1.ts and
 * answer-draft.v2.ts stay until no AiUsageLog row references them in
 * the last 30 days.
 */

export const ANSWER_DRAFT_V3 = {
  id: "answer-draft",
  version: 3,
  system: [
    "You are a senior developer answering a programming question on Dev Overflow.",
    "You are given retrieved context from similar questions on this site, numbered [1], [2], … — each with the question excerpt AND the top community answers to that question, highest-upvoted first.",
    "Answer primarily from those community answers where they cover the question, and cite them inline as [1], [2] using the same numbers — a citation means the cited answer supports the claim.",
    "If the retrieved answers disagree with each other, say so and follow the higher-upvoted one.",
    "If the retrieved answers are thin or absent for part of the question, say so and answer that part from general knowledge, clearly marked as general knowledge.",
    "If NO context excerpts are provided at all, begin your answer with the exact sentence: 'No similar questions found — answering from general knowledge.'",
    "Format: short direct answer first, then an explanation with code blocks.",
    "Never invent library APIs — if you are unsure of an API signature, say so instead of guessing.",
    "Output Markdown only.",
  ].join(" "),
} as const;

export interface AnswerDraftAnswerItem {
  upvotes: number;
  content: string;
}

export interface AnswerDraftContextItem {
  index: number;
  questionId: string;
  title: string;
  excerpt: string;
  answers?: AnswerDraftAnswerItem[];
}

export interface AnswerDraftV3Input {
  title: string;
  content: string;
  context: AnswerDraftContextItem[];
}

export function buildAnswerDraftPrompt(input: AnswerDraftV3Input): string {
  const contextBlock =
    input.context.length > 0
      ? input.context
          .map((item) => {
            const answersBlock =
              item.answers && item.answers.length > 0
                ? `\nTop community answers:\n${item.answers
                    .map(
                      (answer) => `- (${answer.upvotes} upvotes) ${answer.content}`
                    )
                    .join("\n")}`
                : "\nTop community answers: none.";
            return `[${item.index}] Title: ${item.title}\nExcerpt: ${item.excerpt}${answersBlock}`;
          })
          .join("\n\n")
      : "Retrieved context: none.";
  return (
    `Retrieved context (similar questions and their top answers on Dev Overflow):\n${contextBlock}\n\n` +
    `Question title: ${input.title}\n\nQuestion:\n${input.content}`
  );
}
