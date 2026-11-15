/**
 * Model routing (design §3.2, P1 slice). The text tasks use
 * gemini-3.8-flash: drafts and tag-suggest are short, latency-sensitive
 * calls where flash is the right quality/cost point. (gemini-2.5-flash
 * was the previous model; Google deprecated it with a Dec 1 2026
 * shutdown and limited access to past users, so new keys get a 404 —
 * see scripts/check-ai-model.ts.) A "deeper answer" (pro) option and
 * provider fallback are later phases (P5) — with a single provider
 * there is nothing to fall back to, so no health-based demotion is
 * implemented here.
 */
import type { AiTask } from "@/database/ai-usage-log.model";
import { geminiProvider, type LlmProvider } from "./client";

export const AI_MODEL_FOR_TASK: Record<AiTask, string> = {
  "answer-draft": "gemini-3.8-flash",
  "tag-suggest": "gemini-3.8-flash",
  // gemini-embedding-2 — the only embedding model in P2.
  // (text-embedding-004 was shut down by Google on Jan 14, 2026.)
  embedding: "gemini-embedding-2",
  "duplicate-detect": "gemini-3.8-flash",
  // MCP tool calls are not provider calls (read-only DB/RAG calls),
  // so there is no model to route to. "none" keeps the record total
  // over AiTask; getModelForTask("mcp") is never called.
  mcp: "none",
};

export function getModelForTask(task: AiTask): string {
  return AI_MODEL_FOR_TASK[task];
}

export function getLlmProvider(): LlmProvider {
  return geminiProvider;
}
