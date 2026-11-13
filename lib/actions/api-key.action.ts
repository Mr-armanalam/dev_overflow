/**
 * Server actions for MCP API-key management (design §6.2).
 *
 * Creation is gated on the P3 `mcp:key:create` permission — per the
 * P3 matrix that is minimum role "user" (any signed-in user may
 * create a key). Enforced here via requirePermission; the UI only
 * decides what to show.
 *
 * The raw key is returned exactly once, at creation. It is never
 * stored and never returned again — later reads only show the
 * keyPrefix (first 8 chars) so the user can tell keys apart.
 */
"use server";

import { Types } from "mongoose";
import { revalidatePath } from "next/cache";
import ApiKey from "@/database/api-key.model";
import { connectToDatabase } from "@/lib/mongoose";
import { requirePermission } from "@/lib/auth/server-permissions";
import {
  API_KEY_TTL_DAYS,
  generateApiKey,
  hashApiKey,
} from "@/lib/ai/mcp/auth";

export interface ApiKeyListItem {
  id: string;
  name: string;
  scopes: string[];
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export async function createApiKey(params: {
  name: string;
  allowDraft: boolean;
}): Promise<{
  success: boolean;
  key?: string;
  error?: string;
}> {
  try {
    const acting = await requirePermission("mcp:key:create");
    if (!acting.mongoUser) {
      return { success: false, error: "Account not synced yet. Try again." };
    }
    const name = params.name.trim();
    if (!name || name.length > 100) {
      return { success: false, error: "Name must be 1–100 characters" };
    }

    const rawKey = generateApiKey();
    await connectToDatabase();
    await ApiKey.create({
      userId: acting.mongoUser._id as Types.ObjectId,
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.slice(0, 8),
      name,
      scopes: params.allowDraft ? ["mcp:read", "mcp:draft"] : ["mcp:read"],
      expiresAt: new Date(Date.now() + API_KEY_TTL_DAYS * 86_400_000),
    });

    revalidatePath("/profile/edit");
    // The ONLY time the raw key is ever returned. The client must
    // show it once and never store it.
    return { success: true, key: rawKey };
  } catch (error) {
    console.log(error);
    const message =
      error instanceof Error ? error.message : "Could not create API key";
    if (message.startsWith("Unauthorized:") || message.startsWith("Forbidden:")) {
      return { success: false, error: message };
    }
    return { success: false, error: "Could not create API key" };
  }
}

export async function listApiKeys(): Promise<{
  success: boolean;
  keys?: ApiKeyListItem[];
  error?: string;
}> {
  try {
    const acting = await requirePermission("mcp:key:create");
    if (!acting.mongoUser) {
      return { success: false, error: "Account not synced yet. Try again." };
    }
    await connectToDatabase();
    const keys = await ApiKey.find({
      userId: acting.mongoUser._id as Types.ObjectId,
    })
      .sort({ createdAt: -1 })
      .lean();
    return {
      success: true,
      keys: keys.map((key) => ({
        id: String(key._id),
        name: key.name,
        scopes: key.scopes,
        keyPrefix: key.keyPrefix,
        lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
        expiresAt: key.expiresAt.toISOString(),
        revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
        createdAt: key.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.log(error);
    return { success: false, error: "Could not list API keys" };
  }
}

export async function revokeApiKey(params: {
  keyId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const acting = await requirePermission("mcp:key:create");
    if (!acting.mongoUser) {
      return { success: false, error: "Account not synced yet. Try again." };
    }
    if (!Types.ObjectId.isValid(params.keyId)) {
      return { success: false, error: "Invalid key" };
    }
    await connectToDatabase();
    const key = await ApiKey.findOneAndUpdate(
      {
        _id: params.keyId,
        userId: acting.mongoUser._id as Types.ObjectId,
        revokedAt: { $exists: false },
      },
      { revokedAt: new Date() }
    );
    if (!key) {
      return { success: false, error: "API key not found" };
    }
    revalidatePath("/profile/edit");
    return { success: true };
  } catch (error) {
    console.log(error);
    return { success: false, error: "Could not revoke API key" };
  }
}
