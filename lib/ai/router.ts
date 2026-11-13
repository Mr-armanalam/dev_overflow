/**
 * Model routing (design §3.2, P1 slice). Both P1 tasks use
 * gemini-2.5-flash: drafts and tag-suggest are short, latency-sensitive
 * calls where flash is the right quality/cost point. A "deeper answer"
 * (pro) option and provider fallback are later phases (P5) — with a
 * single provider there is nothing to fall back to, so no health-based
 * demotion is implemented here.
 */
import type { AiTask } from "@/database/ai-usage-log.model";
import { geminiProvider, type LlmProvider } from "./client";

export const AI_MODEL_FOR_TASK: Record<AiTask, string> = {
  "answer-draft": "gemini-2.5-flash",
  "tag-suggest": "gemini-2.5-flash",
  // text-embedding-004 — the only embedding model in P2.
  embedding: "text-embedding-004",
  "duplicate-detect": "gemini-2.5-flash",
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
