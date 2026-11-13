/**
 * Recording AI duplicate suggestions for the moderator review queue
 * (design §7.2, P3). Called from POST /api/ai/similar when the
 * duplicate-detect verdict is a duplicate with confidence >= 0.8.
 *
 * Dedupe: the similar endpoint fires on debounced keystrokes, so the
 * same draft can trigger the same verdict repeatedly. A pending
 * suggestion for the same asker + original question + draft title
 * within 24 h is reused instead of creating a new row.
 */
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import DuplicateSuggestion, {
  type IDuplicateSuggestion,
} from "@/database/duplicate-suggestion.model";

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RecordDuplicateSuggestionInput {
  suggestedBy: Types.ObjectId;
  draftTitle: string;
  draftBody?: string;
  duplicateOfId: string;
  confidence: number;
  reason: string;
}

export async function recordDuplicateSuggestion(
  input: RecordDuplicateSuggestionInput
): Promise<IDuplicateSuggestion | null> {
  try {
    await connectToDatabase();
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const existing = await DuplicateSuggestion.findOne({
      suggestedBy: input.suggestedBy,
      duplicateOfId: new Types.ObjectId(input.duplicateOfId),
      draftTitle: input.draftTitle,
      status: "pending",
      createdAt: { $gte: since },
    });
    if (existing) {
      return existing;
    }
    return DuplicateSuggestion.create({
      suggestedBy: input.suggestedBy,
      draftTitle: input.draftTitle,
      draftBody: input.draftBody,
      duplicateOfId: new Types.ObjectId(input.duplicateOfId),
      confidence: input.confidence,
      reason: input.reason,
      status: "pending",
    });
  } catch (error) {
    // Recording must never break the similar-questions response.
    console.error("Failed to record duplicate suggestion", error);
    return null;
  }
}
