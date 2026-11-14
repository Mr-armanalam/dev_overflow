/**
 * Server actions for the AI features: feedback thumbs on AI drafts.
 * A user may only rate their own AI calls — the log row must belong
 * to the signed-in user. Feedback feeds the eval loop (design §9.2).
 */
"use server";

import { Types } from "mongoose";
import AiUsageLog, { type AiFeedback } from "@/database/ai-usage-log.model";
import { connectToDatabase } from "@/lib/mongoose";
import { getAuthenticatedUser } from "@/lib/auth";

export async function recordAiFeedback(params: {
  usageLogId: string;
  feedback: AiFeedback;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const mongoUser = await getAuthenticatedUser();
    const { usageLogId, feedback } = params;

    if (!Types.ObjectId.isValid(usageLogId)) {
      return { success: false, error: "Invalid feedback reference" };
    }

    await connectToDatabase();
    const log = await AiUsageLog.findOne({
      _id: usageLogId,
      userId: mongoUser._id,
    });
    if (!log) {
      return { success: false, error: "AI call not found" };
    }

    log.feedback = feedback;
    await log.save();
    return { success: true };
  } catch (error) {
    console.log(error);
    return { success: false, error: "Could not save feedback" };
  }
}
