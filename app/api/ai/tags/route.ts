/**
 * POST /api/ai/tags — tag suggestions (design §4.2.4).
 * Thin handler: auth → validate → budget → lib/ai → JSON. The model
 * only picks from the existing Tag collection: the tag list is passed
 * in the prompt, the result is filtered against the collection
 * afterwards, and if nothing survives the filter the route falls back
 * to the existing getTopPopularTags. A suggested tag is never
 * auto-applied — the ask-question form shows chips the user confirms.
 */
import { NextResponse } from "next/server";
import type { Types } from "mongoose";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongoose";
import Tag from "@/database/tag.model";
import { getTopPopularTags } from "@/lib/actions/tag.action";
import { isAiEnabled } from "@/lib/ai/limits";
import {
  AiTagSuggestInputSchema,
  detectPromptInjection,
  scrubPII,
} from "@/lib/ai/guardrails/input";
import {
  TAG_SUGGEST_V1,
  buildTagSuggestPrompt,
} from "@/lib/ai/prompts/tag-suggest.v1";
import { getLlmProvider, getModelForTask } from "@/lib/ai/router";
import { checkDailyBudget } from "@/lib/ai/budgets";
import { createUsageLog, updateUsageLog } from "@/lib/ai/observability";

const TagSuggestResponseSchema = z.object({
  tags: z.array(z.string()).max(3),
});

export const POST = async (request: Request) => {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "AI features are temporarily unavailable" },
      { status: 503 }
    );
  }

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
  const parsed = AiTagSuggestInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const budget = await checkDailyBudget(userId, "tag-suggest");
  if (!budget.allowed) {
    try {
      await createUsageLog({
        userId,
        promptId: TAG_SUGGEST_V1.id,
        promptVersion: TAG_SUGGEST_V1.version,
        modelName: getModelForTask("tag-suggest"),
        task: "tag-suggest",
        status: "rejected",
        errorCode: "BUDGET_EXCEEDED",
      });
    } catch (error) {
      console.error("Failed to log rejected AI tag call", error);
    }
    return NextResponse.json(
      {
        error: `Daily AI tag-suggestion limit reached (${budget.limit}/day). Try again tomorrow.`,
        retryAfter: budget.retryAfterSeconds,
      },
      { status: 429 }
    );
  }

  const title = scrubPII(parsed.data.title);
  const bodyText = scrubPII(parsed.data.body);
  const flagged = detectPromptInjection(`${title}\n${bodyText}`);
  const model = getModelForTask("tag-suggest");
  const startedAt = Date.now();

  let usageLog;
  try {
    usageLog = await createUsageLog({
      userId,
      promptId: TAG_SUGGEST_V1.id,
      promptVersion: TAG_SUGGEST_V1.version,
      modelName: model,
      task: "tag-suggest",
      status: flagged ? "flagged" : "pending",
    });
  } catch (error) {
    console.error("Failed to create AI usage log row", error);
    return NextResponse.json(
      { error: "Could not start the AI tag suggestion" },
      { status: 500 }
    );
  }
  const usageLogId = String(usageLog._id);

  try {
    await connectToDatabase();
    const existingTags = await Tag.find({}).select("name").lean();
    const existingNames = existingTags.map((tag) => tag.name);

    const provider = getLlmProvider();
    const { object, usage, latencyMs } = await provider.generateObject({
      system: TAG_SUGGEST_V1.system,
      prompt: buildTagSuggestPrompt({
        title,
        body: bodyText,
        existingTags: existingNames.slice(0, 200),
      }),
      model,
      schema: TagSuggestResponseSchema,
      maxTokens: 256,
    });

    // Keep only tags that really exist, in their canonical casing.
    const byLower = new Map(
      existingNames.map((name) => [name.toLowerCase(), name])
    );
    const tags: string[] = [];
    for (const raw of object.tags) {
      const canonical = byLower.get(raw.trim().toLowerCase());
      if (canonical && !tags.includes(canonical)) {
        tags.push(canonical);
      }
      if (tags.length >= 3) break;
    }

    let fallback = false;
    let finalTags = tags;
    if (finalTags.length === 0) {
      // The model returned nothing usable — fall back to the most
      // popular existing tags instead of showing nothing.
      fallback = true;
      const popular = await getTopPopularTags();
      finalTags = popular
        .slice(0, 3)
        .map((tag: { name: string }) => tag.name);
    }

    await updateUsageLog(usageLogId, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      status: flagged ? "flagged" : "success",
    });

    return NextResponse.json({
      tags: finalTags,
      fallback,
      model,
      promptId: TAG_SUGGEST_V1.id,
      promptVersion: TAG_SUGGEST_V1.version,
    });
  } catch (error) {
    try {
      await updateUsageLog(usageLogId, {
        latencyMs: Date.now() - startedAt,
        status: "error",
        errorCode:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "PROVIDER_ERROR",
      });
    } catch (logError) {
      console.error("Failed to log failed AI tag call", logError);
    }
    return NextResponse.json(
      { error: "AI tag suggestion failed. Please try again." },
      { status: 502 }
    );
  }
};
