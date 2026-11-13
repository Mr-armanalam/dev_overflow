import { Schema, model, models, Document } from "mongoose";

/**
 * An AI-generated answer draft: created when a streaming draft finishes,
 * marked "used" when the user submits it as their answer. Drafts are
 * never auto-published — the user always reviews, edits and submits.
 *
 * status:
 * - "generated" — draft produced, waiting in the answer form
 * - "used"      — submitted as an answer (the answer carries
 *                 aiAssisted=true and earns no reputation)
 * - "discarded" — reserved for a future "discard draft" action
 */
export type AiDraftStatus = "generated" | "used" | "discarded";

export interface IAiDraft extends Document {
  userId: Schema.Types.ObjectId;
  questionId: Schema.Types.ObjectId;
  /** The draft as Markdown, exactly as the model produced it. */
  content: string;
  promptId: string;
  promptVersion: number;
  modelName: string;
  status: AiDraftStatus;
  createdAt: Date;
}

const AiDraftSchema = new Schema<IAiDraft>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
  content: { type: String, required: true },
  promptId: { type: String, required: true },
  promptVersion: { type: Number, required: true },
  modelName: { type: String, required: true },
  status: {
    type: String,
    enum: ["generated", "used", "discarded"],
    default: "generated",
  },
  createdAt: { type: Date, default: Date.now },
});

AiDraftSchema.index({ userId: 1, questionId: 1, createdAt: -1 });

const AiDraft = models.AiDraft || model<IAiDraft>("AiDraft", AiDraftSchema);

export default AiDraft;
