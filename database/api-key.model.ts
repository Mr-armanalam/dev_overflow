import { Schema, model, models, Document } from "mongoose";

/**
 * A per-user API key for the MCP server (design §6.2).
 *
 * The full key is shown ONCE at creation and never stored: only its
 * SHA-256 hash lives in this collection, so a database leak does not
 * leak usable keys. `Authorization: Bearer <key>` on /api/mcp.
 *
 * scopes:
 * - "mcp:read"  — search_questions, get_question, list_tags,
 *                 get_user_stats
 * - "mcp:draft" — create_answer_draft (in addition to the read tools)
 *
 * Keys expire 90 days after creation by default (expiresAt is always
 * set); a revoked key is unusable immediately (revokedAt set).
 * lastUsedAt is updated best-effort on each authenticated call.
 */
export type ApiKeyScope = "mcp:read" | "mcp:draft";

export interface IApiKey extends Document {
  userId: Schema.Types.ObjectId;
  /** SHA-256 hex of the full key. The key itself is never stored. */
  keyHash: string;
  /** First 8 chars of the raw key (e.g. "dov_ab12") — an identifier
   *  for the list UI only. Not secret, not enough to guess the key. */
  keyPrefix: string;
  name: string;
  scopes: ApiKeyScope[];
  lastUsedAt?: Date;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  keyHash: { type: String, required: true, unique: true, index: true },
  keyPrefix: { type: String, required: true },
  name: { type: String, required: true, maxlength: 100 },
  scopes: {
    type: [String],
    enum: ["mcp:read", "mcp:draft"],
    required: true,
  },
  lastUsedAt: { type: Date },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

ApiKeySchema.index({ userId: 1, createdAt: -1 });

const ApiKey = models.ApiKey || model<IApiKey>("ApiKey", ApiKeySchema);

export default ApiKey;
