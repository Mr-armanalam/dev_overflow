/**
 * Moderator duplicate-review queue actions (design §7.2, P3).
 *
 * Reading/reviewing the queue requires `ai:duplicate:confirm`
 * (moderator or admin), enforced server-side in every action — the
 * /admin/duplicates page gates itself the same way, but these actions
 * can be invoked directly, so they never trust the caller.
 *
 * Confirming a suggestion records the decision only: it does NOT
 * close, delete or redirect anything. Rejecting removes the row from
 * the queue (status "rejected", kept for audit).
 */
"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import DuplicateSuggestion from "@/database/duplicate-suggestion.model";
import { getAuthenticatedUser } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import {
  requirePermission,
  resolveActingUser,
} from "@/lib/auth/server-permissions";

/** Plain, serializable shape for the review page (no ObjectIds). */
export interface DuplicateSuggestionDTO {
  id: string;
  questionId: string | null;
  questionTitle: string | null;
  draftTitle: string;
  draftBody: string | null;
  duplicateOfId: string;
  duplicateOfTitle: string;
  confidence: number;
  reason: string;
  suggestedByUsername: string;
  createdAt: string;
}

interface PopulatedSuggestion {
  _id: Types.ObjectId;
  questionId?: { _id: Types.ObjectId; title: string } | null;
  draftTitle: string;
  draftBody?: string;
  duplicateOfId: { _id: Types.ObjectId; title: string };
  confidence: number;
  reason: string;
  suggestedBy: { username: string };
  createdAt: Date;
}

function toDTO(row: PopulatedSuggestion): DuplicateSuggestionDTO {
  return {
    id: String(row._id),
    questionId: row.questionId ? String(row.questionId._id) : null,
    questionTitle: row.questionId?.title ?? null,
    draftTitle: row.draftTitle,
    draftBody: row.draftBody ?? null,
    duplicateOfId: String(row.duplicateOfId._id),
    duplicateOfTitle: row.duplicateOfId.title,
    confidence: row.confidence,
    reason: row.reason,
    suggestedByUsername: row.suggestedBy.username,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getPendingDuplicateSuggestions(): Promise<{
  success: boolean;
  suggestions?: DuplicateSuggestionDTO[];
  error?: string;
}> {
  try {
    await requirePermission("ai:duplicate:confirm");
    await connectToDatabase();
    const rows = await DuplicateSuggestion.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate({ path: "duplicateOfId", select: "title" })
      .populate({ path: "questionId", select: "title" })
      .populate({ path: "suggestedBy", select: "username" })
      .lean<PopulatedSuggestion[]>();
    return { success: true, suggestions: rows.map(toDTO) };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not load duplicate suggestions",
    };
  }
}

/**
 * Attach the submitted question to a suggestion recorded while the
 * asker was still typing. Only the asker (or a moderator/admin) may
 * link it; linking twice is a no-op.
 */
export async function linkDuplicateSuggestionToQuestion(params: {
  suggestionId: string;
  questionId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const mongoUser = await getAuthenticatedUser();
    await connectToDatabase();
    const suggestion = await DuplicateSuggestion.findById(
      params.suggestionId
    );
    if (!suggestion) {
      return { success: false, error: "Duplicate suggestion not found" };
    }
    const isOwner =
      String(suggestion.suggestedBy) === String(mongoUser._id);
    if (!isOwner) {
      const acting = await resolveActingUser();
      if (!acting || !can(acting.role, "ai:duplicate:confirm")) {
        return { success: false, error: "Forbidden" };
      }
    }
    if (!suggestion.questionId) {
      suggestion.questionId = new Types.ObjectId(params.questionId);
      await suggestion.save();
    }
    return { success: true };
  } catch (error) {
    console.log(error);
    return { success: false, error: "Could not link duplicate suggestion" };
  }
}

export async function reviewDuplicateSuggestion(params: {
  suggestionId: string;
  decision: "confirmed" | "rejected";
}): Promise<{ success: boolean; error?: string }> {
  try {
    const acting = await requirePermission("ai:duplicate:confirm");
    if (!acting.mongoUser) {
      return { success: false, error: "User not found" };
    }
    await connectToDatabase();
    const suggestion = await DuplicateSuggestion.findById(
      params.suggestionId
    );
    if (!suggestion) {
      return { success: false, error: "Duplicate suggestion not found" };
    }
    if (suggestion.status !== "pending") {
      return { success: false, error: "This suggestion was already reviewed" };
    }
    suggestion.status = params.decision;
    suggestion.reviewedBy = acting.mongoUser._id as Types.ObjectId;
    await suggestion.save();
    revalidatePath("/admin/duplicates");
    return { success: true };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not review duplicate suggestion",
    };
  }
}
