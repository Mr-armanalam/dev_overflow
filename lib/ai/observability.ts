/**
 * AiUsageLog writes (design §9.1). Every AI call writes one row,
 * including failures and budget rejections — logging failures must
 * never break the AI call itself, so callers wrap these in try/catch.
 */
import AiUsageLog, {
  type AiTask,
  type AiUsageStatus,
  type IAiUsageLog,
} from "@/database/ai-usage-log.model";
import { connectToDatabase } from "@/lib/mongoose";
import type { Types } from "mongoose";
import { estimateCostUsd } from "./pricing";

export interface CreateUsageLogInput {
  userId: Types.ObjectId;
  promptId: string;
  promptVersion: number;
  modelName: string;
  task: AiTask;
  status?: AiUsageStatus;
  errorCode?: string;
}

export async function createUsageLog(
  input: CreateUsageLogInput
): Promise<IAiUsageLog> {
  await connectToDatabase();
  return AiUsageLog.create({
    userId: input.userId,
    actorType: "user",
    promptId: input.promptId,
    promptVersion: input.promptVersion,
    modelName: input.modelName,
    provider: "gemini",
    task: input.task,
    status: input.status ?? "pending",
    errorCode: input.errorCode,
  });
}

export interface UpdateUsageLogPatch {
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  status?: AiUsageStatus;
  errorCode?: string;
}

/** Updates a row and recomputes costUsd from the stored model + tokens. */
export async function updateUsageLog(
  id: string,
  patch: UpdateUsageLogPatch
): Promise<void> {
  await connectToDatabase();
  const log = await AiUsageLog.findById(id);
  if (!log) return;
  if (patch.inputTokens !== undefined) log.inputTokens = patch.inputTokens;
  if (patch.outputTokens !== undefined) {
    log.outputTokens = patch.outputTokens;
  }
  if (patch.latencyMs !== undefined) log.latencyMs = patch.latencyMs;
  if (patch.status !== undefined) log.status = patch.status;
  if (patch.errorCode !== undefined) log.errorCode = patch.errorCode;
  log.costUsd = estimateCostUsd(
    log.modelName,
    log.inputTokens,
    log.outputTokens
  );
  await log.save();
}
