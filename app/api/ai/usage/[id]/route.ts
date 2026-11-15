/**
 * GET /api/ai/usage/[id] — read one AiUsageLog row the caller owns.
 *
 * Exists so the answer form can explain an empty draft: the draft
 * route records the AI SDK finish reason (e.g. a safety block) in
 * the row's errorCode, and the client fetches it after an empty
 * stream instead of guessing. A read, not a provider call — no
 * budget impact.
 */
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import AiUsageLog from "@/database/ai-usage-log.model";
import { getAuthenticatedUser, isSameId } from "@/lib/auth";

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  let mongoUser;
  try {
    mongoUser = await getAuthenticatedUser();
  } catch {
    return NextResponse.json(
      { error: "Unauthorized: please sign in" },
      { status: 401 }
    );
  }

  const { id } = await params;
  await connectToDatabase();
  const log = await AiUsageLog.findById(id).lean();
  if (!log) {
    return NextResponse.json(
      { error: "Usage log not found" },
      { status: 404 }
    );
  }
  if (!isSameId(log.userId, mongoUser._id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    status: log.status,
    errorCode: log.errorCode ?? null,
    cacheHit: log.cacheHit,
    outputTokens: log.outputTokens,
  });
};
