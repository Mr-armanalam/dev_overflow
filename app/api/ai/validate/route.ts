/**
 * POST /api/ai/validate — self-validation for an AI answer draft.
 * Thin handler: auth → validate → lib/ai/validate → JSON. Same auth
 * as the draft route, no extra budget consumption: validation is part
 * of the draft request that already passed the budget check, and its
 * tokens are added to that request's AiUsageLog row.
 *
 * Validation never breaks the draft: any failure returns 200 with
 * verdict "unavailable" and the client keeps the original draft.
 * The response also carries the grounding sources (with top answers)
 * so the client can render richer Sources than the draft header's.
 */
import { NextResponse } from "next/server";
import type { Types } from "mongoose";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  validateDraft,
  ValidateDraftInputSchema,
  unavailableValidationResult,
} from "@/lib/ai/validate";

export const POST = async (request: Request) => {
  let mongoUser;
  try {
    mongoUser = await getAuthenticatedUser();
  } catch {
    return NextResponse.json(
      { error: "Unauthorized: please sign in" },
      { status: 401 }
    );
  }
  const userId = mongoUser._id as Types.ObjectId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
  const parsed = ValidateDraftInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await validateDraft({
      userId,
      questionId: parsed.data.questionId,
      draft: parsed.data.draft,
      usageLogId: parsed.data.usageLogId,
    });
    return NextResponse.json(result);
  } catch (error) {
    // Defensive: validateDraft never throws, but a failure here must
    // still not take the draft away — the client keeps the original.
    console.error("AI validation failed, keeping original draft", error);
    return NextResponse.json(unavailableValidationResult());
  }
};
