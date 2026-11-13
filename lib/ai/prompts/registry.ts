/**
 * Versioned prompt registry (design §4.1). Every AI call logs
 * { promptId, promptVersion } in AiUsageLog, so a bad prompt version
 * can be traced and rolled back. Prompts are TypeScript modules —
 * type-checked and reviewable in PRs — never strings in routes.
 */
import { ANSWER_DRAFT_V2 } from "./answer-draft.v2";
import { TAG_SUGGEST_V1 } from "./tag-suggest.v1";
import { DUPLICATE_DETECT_V1 } from "./duplicate-detect.v1";

export const PROMPTS = {
  "answer-draft": ANSWER_DRAFT_V2,
  "tag-suggest": TAG_SUGGEST_V1,
  "duplicate-detect": DUPLICATE_DETECT_V1,
} as const;

export type PromptId = keyof typeof PROMPTS;
