/**
 * Safe Markdown → HTML for AI output (design §8.1, output layer).
 * `marked` renders, `isomorphic-dompurify` sanitises — this replaces
 * the hand-rolled `formatAIGeneratedText` for AI output. The old
 * /api/chatgpt route still uses formatAIGeneratedText, so that
 * function stays until the old route is removed (separate decision).
 *
 * Usable from server and client code (isomorphic-dompurify is
 * isomorphic by design); the answer form renders the streaming draft
 * preview with this.
 */
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

export async function renderAiMarkdown(markdown: string): Promise<string> {
  const rawHtml = await marked.parse(markdown);
  return DOMPurify.sanitize(rawHtml);
}
