/**
 * Degraded mode for the AI draft endpoint (design §8.2, P3).
 *
 * When the provider is down, the budget is exhausted, or the kill
 * switch is on, the draft endpoint serves similar questions instead
 * of a bare error, plus a "try again later" state. The fallback uses
 * the existing keyword search (globalSearch) — no embedding call, so
 * it works even when the provider is completely unreachable. It is
 * best-effort: any failure returns an empty list, never an error.
 */
import { globalSearch } from "@/lib/actions/general.action";

export interface DegradedSimilarQuestion {
  questionId: string;
  title: string;
}

export async function getDegradedSimilarQuestions(
  title: string
): Promise<DegradedSimilarQuestion[]> {
  try {
    // Escape regex metacharacters: globalSearch builds a $regex from
    // the raw query, and a question title may contain ( ) ? etc.
    const safeQuery = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const raw = await globalSearch({ query: safeQuery, type: "question" });
    const results = JSON.parse(raw) as Array<{
      id?: unknown;
      title?: unknown;
    }>;
    return results
      .filter(
        (item): item is { id: string; title: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof item.id === "string" &&
          typeof item.title === "string"
      )
      .slice(0, 5)
      .map((item) => ({ questionId: item.id, title: item.title }));
  } catch (error) {
    console.error("Degraded-mode similar questions failed", error);
    return [];
  }
}
