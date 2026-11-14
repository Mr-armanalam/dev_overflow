import { Schema, model, models, Document } from "mongoose";

/**
 * An AI duplicate suggestion awaiting moderator review (design §7.2,
 * P3). Created by POST /api/ai/similar when the duplicate-detect
 * verdict is a duplicate with confidence >= 0.8.
 *
 * The suggestion is recorded when the asker is still typing: the new
 * question does not exist yet, so `questionId` is empty until the
 * asker submits — the ask-question form links it afterwards
 * (linkDuplicateSuggestionToQuestion). `draftTitle`/`draftBody` are
 * what the asker had typed, so a moderator can judge the suggestion
 * even if the question is never submitted.
 *
 * status:
 * - "pending"   — awaiting a moderator/admin decision
 * - "confirmed" — a moderator agreed it is a duplicate (records the
 *                 decision only — confirming NEVER closes anything
 *                 automatically; the link to the original is shown)
 * - "rejected"  — removed from the queue (row kept for audit)
 */
export type DuplicateSuggestionStatus =
  | "pending"
  | "confirmed"
  | "rejected";

export interface IDuplicateSuggestion extends Document {
  /** The asker's question, once submitted (empty while drafting). */
  questionId?: Schema.Types.ObjectId;
  draftTitle: string;
  draftBody?: string;
  /** The existing question the draft looks like a duplicate of. */
  duplicateOfId: Schema.Types.ObjectId;
  confidence: number;
  reason: string;
  suggestedBy: Schema.Types.ObjectId;
  status: DuplicateSuggestionStatus;
  reviewedBy?: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DuplicateSuggestionSchema = new Schema<IDuplicateSuggestion>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: "Question" },
    draftTitle: { type: String, required: true },
    draftBody: { type: String },
    duplicateOfId: {
      type: Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    reason: { type: String, required: true },
    suggestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "rejected"],
      default: "pending",
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// The review queue scans pending rows newest-first; the dedupe check
// in lib/ai/duplicates.ts looks up by asker + original + status.
DuplicateSuggestionSchema.index({ status: 1, createdAt: -1 });
DuplicateSuggestionSchema.index({
  suggestedBy: 1,
  duplicateOfId: 1,
  status: 1,
  createdAt: -1,
});

const DuplicateSuggestion =
  models.DuplicateSuggestion ||
  model<IDuplicateSuggestion>(
    "DuplicateSuggestion",
    DuplicateSuggestionSchema
  );

export default DuplicateSuggestion;
