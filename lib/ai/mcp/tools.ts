/**
 * MCP tool implementations (design §6.1).
 *
 * Each tool reuses an existing server action or lib/ai helper — no
 * duplicated domain logic. Tools return MCP text content (JSON) or an
 * `isError` result; they never throw across the transport boundary.
 *
 * Deliberately NOT exposed: create_question, publish_answer, vote,
 * delete_* — anything that changes reputation or publishes content.
 * The only write is `create_answer_draft`, which stores an AiDraft
 * for human review and never publishes.
 *
 * Every call is logged to AiUsageLog (actorType "api-key", task "mcp",
 * promptId `mcp:<tool>`) by `withMcpLogging` — logging failures never
 * break the tool. Scopes are enforced at the top of each tool, before
 * the tool body runs.
 */
import { Types } from "mongoose";
import { z } from "zod";
import { connectToDatabase } from "@/lib/mongoose";
import Question from "@/database/question.model";
import AiDraft from "@/database/ai-draft.model";
import { getQuestionsById } from "@/lib/actions/question.action";
import { getAnswers } from "@/lib/actions/answer.action";
import { getAllTags } from "@/lib/actions/tag.action";
import { getUserInfo } from "@/lib/actions/user.action";
import { globalSearch } from "@/lib/actions/general.action";
import { retrieveSimilar } from "@/lib/ai/rag/retrieve";
import { scrubPII, stripHtmlToText } from "@/lib/ai/guardrails/input";
import { scrubOutput } from "@/lib/ai/guardrails/output";
import { createUsageLog, updateUsageLog } from "@/lib/ai/observability";
import type { ApiKeyContext } from "./auth";

export type McpToolContent = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function toolResult(data: unknown): McpToolContent {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function toolError(message: string): McpToolContent {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/** Scope guard — runs before the tool body. */
function requireScope(
  ctx: ApiKeyContext,
  scope: "mcp:read" | "mcp:draft"
): McpToolContent | null {
  if (!ctx.scopes.includes(scope)) {
    return toolError(
      `This API key does not have the ${scope} scope. Create a key with that scope in profile settings.`
    );
  }
  return null;
}

type ToolFn<TArgs> = (
  ctx: ApiKeyContext,
  args: TArgs
) => Promise<McpToolContent>;

/**
 * Log one MCP tool call (best-effort, never breaks the tool).
 * `modelName` is "none": MCP tools are read-only DB/RAG calls, not
 * provider calls, so there are no tokens to count.
 */
function withMcpLogging<TArgs>(
  toolName: string,
  fn: ToolFn<TArgs>
): ToolFn<TArgs> {
  return async (ctx, args) => {
    const startedAt = Date.now();
    let logId: string | undefined;
    try {
      const log = await createUsageLog({
        userId: ctx.userId,
        actorType: "api-key",
        promptId: `mcp:${toolName}`,
        promptVersion: 1,
        modelName: "none",
        task: "mcp",
        status: "pending",
      });
      logId = String(log._id);
    } catch (error) {
      console.error("Failed to log MCP call (non-fatal)", error);
    }
    const result = await fn(ctx, args);
    if (logId) {
      try {
        await updateUsageLog(logId, {
          latencyMs: Date.now() - startedAt,
          status: result.isError ? "error" : "success",
          errorCode: result.isError ? "TOOL_ERROR" : undefined,
        });
      } catch (error) {
        console.error("Failed to update MCP usage log (non-fatal)", error);
      }
    }
    return result;
  };
}

// ---------------------------------------------------------------------------
// search_questions — RAG retrieval + globalSearch fallback
// ---------------------------------------------------------------------------

export const SearchQuestionsSchema = {
  query: z.string().min(1).max(500).describe("Search text"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Optional tag names to filter by (matched case-insensitively)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Max questions to return (default 5, max 10)"),
};

export type SearchQuestionsArgs = {
  query: string;
  tags?: string[];
  limit?: number;
};

async function searchQuestionsImpl(
  ctx: ApiKeyContext,
  args: SearchQuestionsArgs
): Promise<McpToolContent> {
  const scopeError = requireScope(ctx, "mcp:read");
  if (scopeError) return scopeError;
  const limit = args.limit ?? 5;
  try {
    // Primary: RAG retrieval (vector search + rerank). Best-effort —
    // retrieveSimilar returns [] when the index or embeddings are
    // missing, and the fallback below still answers.
    const sources = await retrieveSimilar({ text: args.query, limit });
    if (sources.length > 0) {
      await connectToDatabase();
      const questions = await Question.find({
        _id: { $in: sources.map((s) => s.questionId) },
      })
        .populate({ path: "tags", model: "Tag", select: "name" })
        .select("_id title tags")
        .lean();
      const byId = new Map(questions.map((q) => [String(q._id), q]));
      const tagFilter = args.tags?.map((t) => t.toLowerCase());
      const results = sources
        .map((source) => {
          const q = byId.get(source.questionId);
          const tags = (
            (q?.tags ?? []) as Array<{ name: string }>
          ).map((tag) => tag.name);
          return {
            id: source.questionId,
            title: source.title,
            tags,
            score: Math.round(source.score * 1000) / 1000,
            snippet: source.snippet,
          };
        })
        .filter(
          (r) =>
            !tagFilter ||
            r.tags.some((tag) => tagFilter.includes(tag.toLowerCase()))
        )
        .slice(0, limit);
      return toolResult({ source: "rag", results });
    }

    // Fallback: keyword search over question titles.
    const raw = await globalSearch({ query: args.query, type: "question" });
    const hits = (
      JSON.parse(raw) as Array<{ title: string; type: string; id: string }>
    ).filter((hit) => hit.type === "question");
    await connectToDatabase();
    const questions = await Question.find({
      _id: { $in: hits.map((h) => h.id) },
    })
      .populate({ path: "tags", model: "Tag", select: "name" })
      .select("_id tags")
      .lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    const tagFilter = args.tags?.map((t) => t.toLowerCase());
    const results = hits
      .map((hit) => {
        const q = byId.get(hit.id);
        const tags = ((q?.tags ?? []) as Array<{ name: string }>).map(
          (tag) => tag.name
        );
        return { id: hit.id, title: hit.title, tags, score: null, snippet: "" };
      })
      .filter(
        (r) =>
          !tagFilter ||
          r.tags.some((tag) => tagFilter.includes(tag.toLowerCase()))
      )
      .slice(0, limit);
    return toolResult({ source: "keyword", results });
  } catch (error) {
    console.error("mcp search_questions failed", error);
    return toolError("Question search failed. Try again later.");
  }
}

export const searchQuestions = withMcpLogging(
  "search_questions",
  searchQuestionsImpl
);

// ---------------------------------------------------------------------------
// get_question — question + optional answers
// ---------------------------------------------------------------------------

export const GetQuestionSchema = {
  id: z.string().min(1).describe("Question id (Mongo ObjectId)"),
  includeAnswers: z
    .boolean()
    .optional()
    .describe("Include the top 10 answers (default false)"),
};

export type GetQuestionArgs = {
  id: string;
  includeAnswers?: boolean;
};

async function getQuestionImpl(
  ctx: ApiKeyContext,
  args: GetQuestionArgs
): Promise<McpToolContent> {
  const scopeError = requireScope(ctx, "mcp:read");
  if (scopeError) return scopeError;
  if (!Types.ObjectId.isValid(args.id)) {
    return toolError("Invalid question id");
  }
  try {
    const question = await getQuestionsById({ questionId: args.id });
    if (!question) {
      return toolError("Question not found");
    }
    const author = question.author as unknown as {
      clerkId?: string;
      name?: string;
    };
    const result: Record<string, unknown> = {
      id: String(question._id),
      title: question.title,
      content: question.content,
      contentText: stripHtmlToText(question.content ?? ""),
      tags: (
        (question.tags ?? []) as Array<{ _id: unknown; name: string }>
      ).map((tag) => ({ id: String(tag._id), name: tag.name })),
      author: { clerkId: author?.clerkId ?? null, name: author?.name ?? null },
      views: question.views ?? 0,
      upvotes: (question.upvotes as unknown[] | undefined)?.length ?? 0,
      downvotes: (question.downvotes as unknown[] | undefined)?.length ?? 0,
      createdAt: question.createdAt,
    };
    if (args.includeAnswers) {
      const { answers } = await getAnswers({
        questionId: args.id,
        sortBy: "highestUpvotes",
        page: 1,
        pageSize: 10,
      });
      result.answers = answers.map((answer) => {
        const answerAuthor = answer.author as unknown as {
          clerkId?: string;
          name?: string;
        };
        return {
          id: String(answer._id),
          content: answer.content,
          contentText: stripHtmlToText(answer.content ?? ""),
          author: {
            clerkId: answerAuthor?.clerkId ?? null,
            name: answerAuthor?.name ?? null,
          },
          upvotes: (answer.upvotes as unknown[] | undefined)?.length ?? 0,
          downvotes:
            (answer.downvotes as unknown[] | undefined)?.length ?? 0,
          aiAssisted: Boolean(
            (answer as unknown as { aiAssisted?: boolean }).aiAssisted
          ),
          createdAt: answer.createdAt,
        };
      });
    }
    return toolResult(result);
  } catch (error) {
    console.error("mcp get_question failed", error);
    return toolError("Could not load the question. Try again later.");
  }
}

export const getQuestion = withMcpLogging("get_question", getQuestionImpl);

// ---------------------------------------------------------------------------
// list_tags — most popular tags
// ---------------------------------------------------------------------------

export const ListTagsSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max tags to return (default 10, max 20)"),
};

export type ListTagsArgs = {
  limit?: number;
};

async function listTagsImpl(
  ctx: ApiKeyContext,
  args: ListTagsArgs
): Promise<McpToolContent> {
  const scopeError = requireScope(ctx, "mcp:read");
  if (scopeError) return scopeError;
  const limit = args.limit ?? 10;
  try {
    const { tags } = await getAllTags({
      page: 1,
      pageSize: limit,
      filter: "popular",
    });
    return toolResult({
      results: tags.map((tag) => ({
        id: String(tag._id),
        name: tag.name,
        questionCount: (tag.questions as unknown[] | undefined)?.length ?? 0,
      })),
    });
  } catch (error) {
    console.error("mcp list_tags failed", error);
    return toolError("Could not list tags. Try again later.");
  }
}

export const listTags = withMcpLogging("list_tags", listTagsImpl);

// ---------------------------------------------------------------------------
// get_user_stats — public fields only, never email
// ---------------------------------------------------------------------------

export const GetUserStatsSchema = {
  clerkId: z.string().min(1).describe("Clerk id of the user"),
};

export type GetUserStatsArgs = {
  clerkId: string;
};

async function getUserStatsImpl(
  ctx: ApiKeyContext,
  args: GetUserStatsArgs
): Promise<McpToolContent> {
  const scopeError = requireScope(ctx, "mcp:read");
  if (scopeError) return scopeError;
  try {
    const info = await getUserInfo({ userId: args.clerkId });
    const user = info.user as unknown as {
      clerkId: string;
      name: string;
      username: string;
      picture?: string;
      joinedAt: Date;
    };
    return toolResult({
      clerkId: user.clerkId,
      name: user.name,
      username: user.username,
      picture: user.picture ?? null,
      reputation: info.reputation,
      totalQuestions: info.totalQuestion,
      totalAnswers: info.totalAnswer,
      badgeCounts: info.badgeCounts,
      joinedAt: user.joinedAt,
    });
  } catch (error) {
    console.error("mcp get_user_stats failed", error);
    return toolError("User not found");
  }
}

export const getUserStats = withMcpLogging("get_user_stats", getUserStatsImpl);

// ---------------------------------------------------------------------------
// create_answer_draft — draft only, NEVER publishes
// ---------------------------------------------------------------------------

export const CreateAnswerDraftSchema = {
  questionId: z.string().min(1).describe("Question id (Mongo ObjectId)"),
  content: z
    .string()
    .min(1)
    .max(20000)
    .describe("Draft answer content (Markdown)"),
};

export type CreateAnswerDraftArgs = {
  questionId: string;
  content: string;
};

async function createAnswerDraftImpl(
  ctx: ApiKeyContext,
  args: CreateAnswerDraftArgs
): Promise<McpToolContent> {
  const scopeError = requireScope(ctx, "mcp:draft");
  if (scopeError) return scopeError;
  if (!Types.ObjectId.isValid(args.questionId)) {
    return toolError("Invalid question id");
  }
  try {
    await connectToDatabase();
    const question = await Question.findById(args.questionId).select("_id");
    if (!question) {
      return toolError("Question not found");
    }
    // Defense in depth: strip any secrets the caller pasted in the
    // draft before storing it. The draft is never published here —
    // a human reviews it in the web UI first.
    const draft = await AiDraft.create({
      userId: ctx.userId,
      questionId: args.questionId,
      content: scrubOutput(scrubPII(args.content)),
      promptId: "mcp",
      promptVersion: 1,
      modelName: "none",
      status: "generated",
    });
    return toolResult({
      draftId: String(draft._id),
      questionId: args.questionId,
      status: "generated",
      message:
        "Draft created for human review. It is not published — open the question in Dev Overflow, review the draft, and submit it as an answer.",
    });
  } catch (error) {
    console.error("mcp create_answer_draft failed", error);
    return toolError("Could not create the draft. Try again later.");
  }
}

export const createAnswerDraft = withMcpLogging(
  "create_answer_draft",
  createAnswerDraftImpl
);
