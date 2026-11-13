/**
 * AiDraft helpers (plain server code, not a server action — the
 * caller, createAnswer, has already authenticated the user).
 */
import { Types } from "mongoose";
import AiDraft from "@/database/ai-draft.model";
import { connectToDatabase } from "@/lib/mongoose";

/**
 * Mark the user's latest generated draft for a question as "used".
 * Best-effort and never throws: a missing draft must not fail the
 * answer submission it is bookkeeping for.
 */
export async function markAiDraftUsed(params: {
  userId: Types.ObjectId;
  questionId: string;
}): Promise<void> {
  try {
    await connectToDatabase();
    await AiDraft.findOneAndUpdate(
      {
        userId: params.userId,
        questionId: params.questionId,
        status: "generated",
      },
      { status: "used" },
      { sort: { createdAt: -1 } }
    );
  } catch (error) {
    console.log("markAiDraftUsed failed (non-fatal)", error);
  }
}
