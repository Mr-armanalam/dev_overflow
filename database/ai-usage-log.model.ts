import { Schema, model, models, Document } from "mongoose";

/**
 * One row per AI call — the single table that answers cost, latency,
 * error-rate and per-user usage questions (design §9.1).
 *
 * status:
 * - "pending"   — streaming call started, outcome not known yet
 * - "success"   — provider returned a usable result
 * - "flagged"   — result returned, but the input tripped the
 *                 prompt-injection screen (flagged + logged, never
 *                 silently rewritten)
 * - "error"     — provider / validation failure after the call started
 * - "rejected"  — refused before calling (budget exhausted, kill switch)
 *                 — these rows never count toward the daily budget
 *
 * "success" and "flagged" both consumed a provider call, so both count
 * toward the daily budget.
 */
export type AiUsageStatus =
  | "pending"
  | "success"
  | "error"
  | "rejected"
  | "flagged";

export type AiTask =
  | "answer-draft"
  | "tag-suggest"
  | "embedding"
  | "duplicate-detect"
  | "mcp";

export type AiFeedback = "helpful" | "not_helpful";

export interface IAiUsageLog extends Document {
  userId: Schema.Types.ObjectId;
  /**
   * "user" — a signed-in web user (P1). "api-key" — an MCP client
   * authenticated with an ApiKey (P4). MCP rows carry no token counts
   * (the tools are read-only DB/RAG calls, not provider calls).
   */
  actorType: "user" | "api-key";
  promptId: string;
  promptVersion: number;
  modelName: string;
  provider: "gemini";
  task: AiTask;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  cacheHit: boolean;
  costUsd: number;
  status: AiUsageStatus;
  errorCode?: string;
  feedback?: AiFeedback;
  createdAt: Date;
}

const AiUsageLogSchema = new Schema<IAiUsageLog>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  actorType: {
    type: String,
    enum: ["user", "api-key"],
    default: "user",
  },
  promptId: { type: String, required: true },
  promptVersion: { type: Number, required: true },
  modelName: { type: String, required: true },
  provider: { type: String, enum: ["gemini"], default: "gemini" },
  task: {
    type: String,
    enum: [
      "answer-draft",
      "tag-suggest",
      "embedding",
      "duplicate-detect",
      "mcp",
    ],
    required: true,
  },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  latencyMs: { type: Number, default: 0 },
  cacheHit: { type: Boolean, default: false },
  costUsd: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["pending", "success", "error", "rejected", "flagged"],
    default: "pending",
  },
  errorCode: { type: String },
  feedback: { type: String, enum: ["helpful", "not_helpful"] },
  createdAt: { type: Date, default: Date.now },
});

// Budget checks count today's rows per user+task; the admin dashboard
// scans by recency.
AiUsageLogSchema.index({ userId: 1, task: 1, createdAt: -1 });
AiUsageLogSchema.index({ createdAt: -1 });

const AiUsageLog =
  models.AiUsageLog || model<IAiUsageLog>("AiUsageLog", AiUsageLogSchema);

export default AiUsageLog;
