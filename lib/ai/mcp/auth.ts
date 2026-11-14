/**
 * MCP API-key authentication (design §6.2).
 *
 * MCP clients are machines, so they authenticate with a per-user API
 * key — never with a Clerk session cookie. The route handler calls
 * `authenticateApiKey(request)` before any MCP handling; the tools
 * then close over the returned context.
 *
 * Key format: `dov_` + 32 random bytes (base64url). Only the SHA-256
 * hash is stored (see database/api-key.model.ts), so a database leak
 * does not leak usable keys.
 */
import { randomBytes, createHash } from "node:crypto";
import type { Types } from "mongoose";
import ApiKey, { type ApiKeyScope, type IApiKey } from "@/database/api-key.model";
import { connectToDatabase } from "@/lib/mongoose";

export const API_KEY_PREFIX = "dov_";
/** Keys expire this long after creation (set at creation time). */
export const API_KEY_TTL_DAYS = 90;

export interface ApiKeyContext {
  /** The ApiKey document (never the raw key — it is not stored). */
  key: IApiKey;
  userId: Types.ObjectId;
  scopes: ApiKeyScope[];
}

/** Generate a new raw key. Returned once to the user, then discarded. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 hex of a raw key — the only form ever stored or looked up. */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/**
 * Authenticate `Authorization: Bearer <key>` on a request. Returns
 * the key context, or null when the header is missing, malformed, or
 * the key is unknown / revoked / expired. Never throws for a bad key —
 * the route maps null to 401. Best-effort: bumps lastUsedAt, but a
 * failed bump must never fail authentication.
 */
export async function authenticateApiKey(
  request: Request
): Promise<ApiKeyContext | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  const rawKey = header.slice("Bearer ".length).trim();
  if (!rawKey.startsWith(API_KEY_PREFIX) || rawKey.length < 40) {
    return null;
  }

  await connectToDatabase();
  const key = await ApiKey.findOne({ keyHash: hashApiKey(rawKey) });
  if (!key) {
    return null;
  }
  if (key.revokedAt) {
    return null;
  }
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  try {
    key.lastUsedAt = new Date();
    await key.save();
  } catch (error) {
    console.error("Failed to bump ApiKey lastUsedAt (non-fatal)", error);
  }

  return { key, userId: key.userId, scopes: key.scopes };
}

/** Scope check, enforced per tool before the tool body runs. */
export function hasScope(
  ctx: ApiKeyContext,
  scope: ApiKeyScope
): boolean {
  return ctx.scopes.includes(scope);
}
