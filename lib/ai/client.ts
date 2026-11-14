/**
 * Provider abstraction (design §3.1). One small interface over the
 * Vercel AI SDK (`ai` + `@ai-sdk/google`); routes never call a provider
 * directly. Only Gemini exists in P1 — a second provider (OpenAI) is a
 * P5 fallback, so health-based demotion is meaningless here and is
 * deliberately not implemented.
 *
 * Resilience (design §3.3): 15 s timeout via AbortSignal, max 2 retries
 * on 429/5xx only with exponential backoff + jitter. The SDK's own
 * retry is disabled (maxRetries: 0) so this wrapper is the only retry
 * logic — otherwise a call could be retried twice over.
 */
import {
  embedMany,
  generateObject,
  generateText,
  streamText,
  zodSchema,
  type LanguageModelUsage,
} from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { z } from "zod";
import { AI_CALL_TIMEOUT_MS, AI_MAX_RETRIES } from "./limits";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmGenerateRequest {
  system: string;
  prompt: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
  /** Cap on output tokens (cost control, design §8.1). */
  maxTokens?: number;
}

export interface LlmGenerateResponse {
  text: string;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
}

export interface LlmStreamResult {
  text: string;
  usage: LlmUsage;
  finishReason: string;
}

export interface LlmEmbedResponse {
  embeddings: number[][];
  /** Input tokens consumed across the batch. */
  inputTokens: number;
}

export interface LlmProvider {
  id: "gemini";
  generate(req: LlmGenerateRequest): Promise<LlmGenerateResponse>;
  generateObject<T>(
    req: LlmGenerateRequest & { schema: z.ZodType<T> }
  ): Promise<{
    object: T;
    usage: LlmUsage;
    model: string;
    latencyMs: number;
  }>;
  stream(req: LlmGenerateRequest & {
    onFinish?: (result: LlmStreamResult) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
  }): Promise<ReturnType<typeof streamText>>;
  /**
   * Embed one or more texts with gemini-embedding-2, requesting
   * 768-d output via `outputDimensionality` (Matryoshka truncation)
   * to match the 768-d Atlas vector index. Same retry/timeout
   * discipline as the text calls. The SDK splits large batches
   * itself; callers keep batches small anyway (a question + its top
   * answers is ≤ 4 texts).
   */
  embedTexts(texts: string[]): Promise<LlmEmbedResponse>;
}

const GEMINI_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  {
    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
    threshold: "BLOCK_MEDIUM_AND_ABOVE",
  },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  {
    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    threshold: "BLOCK_MEDIUM_AND_ABOVE",
  },
  {
    category: "HARM_CATEGORY_CIVIC_INTEGRITY",
    threshold: "BLOCK_MEDIUM_AND_ABOVE",
  },
] as const;

function toUsage(usage: LanguageModelUsage): LlmUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

function isRetryableError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === "number") {
    return statusCode === 429 || statusCode >= 500;
  }
  const message = error instanceof Error ? error.message : "";
  return /\b(429|500|502|503|504)\b/.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > AI_MAX_RETRIES || !isRetryableError(error)) {
        throw error;
      }
      // Exponential backoff + jitter: 500ms, 1000ms (+ up to 250ms).
      await sleep(500 * 2 ** (attempt - 1) + Math.random() * 250);
    }
  }
}

class GeminiProvider implements LlmProvider {
  readonly id = "gemini" as const;

  private getModel(modelId: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    const google = createGoogleGenerativeAI({ apiKey });
    // @ai-sdk/google v2: the provider call takes only the model id.
    // Model options (e.g. safety settings) travel via `providerOptions`
    // on each generate/streamText call — see the three call sites below.
    return google(modelId);
  }

  /** Gemini safety settings, sent via providerOptions on every call. */
  private get providerOptions() {
    return {
      google: { safetySettings: [...GEMINI_SAFETY_SETTINGS] },
    };
  }

  async generate(req: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const startedAt = Date.now();
    const model = this.getModel(req.model);
    const result = await withRetries(() =>
      generateText({
        model,
        system: req.system,
        prompt: req.prompt,
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
        maxRetries: 0,
        providerOptions: this.providerOptions,
        abortSignal: AbortSignal.timeout(
          req.timeoutMs ?? AI_CALL_TIMEOUT_MS
        ),
      })
    );
    return {
      text: result.text,
      usage: toUsage(result.usage),
      model: req.model,
      latencyMs: Date.now() - startedAt,
    };
  }

  async generateObject<T>(
    req: LlmGenerateRequest & { schema: z.ZodType<T> }
  ): Promise<{
    object: T;
    usage: LlmUsage;
    model: string;
    latencyMs: number;
  }> {
    const startedAt = Date.now();
    const model = this.getModel(req.model);
    const result = await withRetries(() =>
      generateObject({
        model,
        system: req.system,
        prompt: req.prompt,
        schema: zodSchema(req.schema),
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
        maxRetries: 0,
        providerOptions: this.providerOptions,
        abortSignal: AbortSignal.timeout(
          req.timeoutMs ?? AI_CALL_TIMEOUT_MS
        ),
      })
    );
    return {
      object: result.object,
      usage: toUsage(result.usage),
      model: req.model,
      latencyMs: Date.now() - startedAt,
    };
  }

  async embedTexts(texts: string[]): Promise<LlmEmbedResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    const google = createGoogleGenerativeAI({ apiKey });
    const embeddingModel = google.textEmbeddingModel(
      "gemini-embedding-2"
    );
    const result = await withRetries(() =>
      embedMany({
        model: embeddingModel,
        values: texts,
        // gemini-embedding-2 is 3072-d by default; request 768-d
        // output (Matryoshka truncation) to match the Atlas index.
        // No taskType: the same call embeds both document chunks
        // and the retrieval query, so one task type would be wrong
        // for one of them.
        providerOptions: { google: { outputDimensionality: 768 } },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
      })
    );
    return {
      embeddings: result.embeddings,
      inputTokens: result.usage.tokens,
    };
  }

  async stream(
    req: LlmGenerateRequest & {
      onFinish?: (result: LlmStreamResult) => void | Promise<void>;
      onError?: (error: unknown) => void | Promise<void>;
    }
  ): Promise<ReturnType<typeof streamText>> {
    const model = this.getModel(req.model);
    // Retries here only cover setup-time failures. Once tokens are
    // flowing, a mid-stream failure cannot be retried without starting
    // a new stream — the client surfaces the error and the user can
    // press Regenerate.
    return withRetries(() =>
      Promise.resolve(
        streamText({
          model,
          system: req.system,
          prompt: req.prompt,
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens,
          maxRetries: 0,
          providerOptions: this.providerOptions,
          abortSignal: AbortSignal.timeout(
            req.timeoutMs ?? AI_CALL_TIMEOUT_MS
          ),
          onFinish: async (event) => {
            await req.onFinish?.({
              text: event.text,
              usage: toUsage(event.usage),
              finishReason: event.finishReason,
            });
          },
          onError: async (event) => {
            await req.onError?.(event.error);
          },
        })
      )
    );
  }
}

export const geminiProvider: LlmProvider = new GeminiProvider();
