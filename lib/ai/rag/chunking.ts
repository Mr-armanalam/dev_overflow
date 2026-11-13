/**
 * Chunking for the RAG corpus (design §5.1). One chunk per question
 * (title + body) and one per top answer, each capped at ~1,500 chars.
 * A body longer than the cap is split on Markdown headings; a single
 * section longer than the cap is hard-split on word boundaries. No
 * sliding windows — the corpus is small and chunks are re-built whole
 * on edit.
 */
import { stripHtmlToText } from "@/lib/ai/guardrails/input";

export const CHUNK_MAX_CHARS = 1500;

/** Split long text on Markdown headings, keeping each heading with
 *  its section. Sections longer than the cap are hard-split below. */
function splitOnHeadings(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      sections.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current.join("\n").trim());
  return sections.filter((section) => section.length > 0);
}

function hardSplit(text: string): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > CHUNK_MAX_CHARS) {
    const cut = rest.lastIndexOf(" ", CHUNK_MAX_CHARS);
    const at = cut > CHUNK_MAX_CHARS / 2 ? cut : CHUNK_MAX_CHARS;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** Split plain text into ≤1,500-char chunks. */
export function chunkText(text: string): string[] {
  const clean = text.trim();
  if (clean.length === 0) return [];
  if (clean.length <= CHUNK_MAX_CHARS) return [clean];
  const out: string[] = [];
  for (const section of splitOnHeadings(clean)) {
    if (section.length <= CHUNK_MAX_CHARS) {
      out.push(section);
    } else {
      out.push(...hardSplit(section));
    }
  }
  return out;
}

/** Question chunk text: title + tag names + body. Tag descriptions
 *  are not separate chunks — the names ride inside this text. */
export function buildQuestionChunkTexts(
  title: string,
  contentHtml: string,
  tagNames: string[]
): string[] {
  const body = stripHtmlToText(contentHtml);
  const header = `Title: ${title.trim()}${
    tagNames.length > 0 ? `\nTags: ${tagNames.join(", ")}` : ""
  }\n\n`;
  const bodyChunks = chunkText(body);
  if (bodyChunks.length === 0) return [header.trim()];
  // Keep the header on the first chunk only; later chunks are body
  // continuations (the title/tags already anchor the question).
  return bodyChunks.map((chunk, i) =>
    i === 0 ? `${header}${chunk}` : chunk
  );
}

/** Answer chunk text: the plain-text answer body. */
export function buildAnswerChunkTexts(contentHtml: string): string[] {
  return chunkText(stripHtmlToText(contentHtml));
}
