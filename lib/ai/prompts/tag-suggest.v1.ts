/**
 * tag-suggest prompt, version 1 (design §4.2.4).
 *
 * The model may only pick from the existing Tag collection — the tag
 * list is passed in the prompt, and the route filters the result
 * against the collection afterwards, so an invented tag can never
 * reach the user. A new version is a NEW file (tag-suggest.v2.ts).
 */

export const TAG_SUGGEST_V1 = {
  id: "tag-suggest",
  version: 1,
  system: [
    "You suggest tags for a programming question on Dev Overflow.",
    "Return up to 3 tags, chosen ONLY from the list of existing tags",
    "supplied in the user message. Never invent a tag that is not in",
    "that list. Prefer the most specific tags that describe the",
    "question's languages, frameworks and problem area.",
  ].join(" "),
} as const;

export interface TagSuggestInput {
  title: string;
  body: string;
  /** Names of the tags that already exist, in canonical casing. */
  existingTags: string[];
}

export function buildTagSuggestPrompt(input: TagSuggestInput): string {
  const tagList =
    input.existingTags.length > 0
      ? input.existingTags.join(", ")
      : "(no tags exist yet)";
  return (
    `Question title: ${input.title}\n\n` +
    `Question:\n${input.body}\n\n` +
    `Existing tags (pick only from these): ${tagList}`
  );
}
