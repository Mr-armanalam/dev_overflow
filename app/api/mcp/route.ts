/**
 * POST /api/mcp — MCP server, Streamable HTTP (design §6).
 *
 * Stateless mode (no sessionIdGenerator): a fresh server + transport
 * is created per request, which is what serverless hosting requires —
 * no in-memory session survives across invocations.
 *
 * Authentication is ONLY `Authorization: Bearer <api-key>`. Clerk
 * session cookies are never accepted here, and the route is listed as
 * public in proxy.ts precisely so Clerk middleware does not redirect
 * MCP clients to sign-in before this handler runs. The tools close
 * over the authenticated key context; scopes are enforced per tool
 * in lib/ai/mcp/tools.ts.
 *
 * Only POST is supported (initialize / tools/list / tools/call).
 * GET and DELETE return 405 — there is no SSE stream to resume in
 * stateless mode.
 */
import { NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateApiKey } from "@/lib/ai/mcp/auth";
import { enforceMcpRateLimit } from "@/lib/ai/mcp/ratelimit";
import {
  CreateAnswerDraftSchema,
  GetQuestionSchema,
  GetUserStatsSchema,
  ListTagsSchema,
  SearchQuestionsSchema,
  createAnswerDraft,
  getQuestion,
  getUserStats,
  listTags,
  searchQuestions,
} from "@/lib/ai/mcp/tools";

export async function POST(request: Request): Promise<Response> {
  const ctx = await authenticateApiKey(request);
  if (!ctx) {
    return NextResponse.json(
      {
        error:
          "Unauthorized: pass a valid Dev Overflow API key as Authorization: Bearer <key>. Create one in profile settings.",
      },
      { status: 401 }
    );
  }

  // 60 requests/min per key (design §6.2). Fails open when Redis is
  // not configured — see lib/ai/mcp/ratelimit.ts.
  const rateLimit = await enforceMcpRateLimit(String(ctx.key._id), ctx.userId);
  if (rateLimit.limited && rateLimit.response) {
    return rateLimit.response;
  }

  const server = new McpServer({
    name: "dev-overflow",
    version: "1.0.0",
  });

  server.registerTool(
    "search_questions",
    {
      description:
        "Search Dev Overflow questions by meaning (RAG) with a keyword fallback. Returns id, title, tags, score and snippet.",
      inputSchema: SearchQuestionsSchema,
    },
    async (args) => searchQuestions(ctx, args)
  );

  server.registerTool(
    "get_question",
    {
      description:
        "Load one question by id, optionally with its top 10 answers.",
      inputSchema: GetQuestionSchema,
    },
    async (args) => getQuestion(ctx, args)
  );

  server.registerTool(
    "list_tags",
    {
      description: "List the most popular tags on Dev Overflow.",
      inputSchema: ListTagsSchema,
    },
    async (args) => listTags(ctx, args)
  );

  server.registerTool(
    "get_user_stats",
    {
      description:
        "Public stats for a user by Clerk id (reputation, question/answer counts, badges). Never returns email.",
      inputSchema: GetUserStatsSchema,
    },
    async (args) => getUserStats(ctx, args)
  );

  server.registerTool(
    "create_answer_draft",
    {
      description:
        "Create an AI answer draft for a question. DRAFT ONLY — it is never published; a human reviews and submits it in the web UI. Requires the mcp:draft scope.",
      inputSchema: CreateAnswerDraftSchema,
    },
    async (args) => createAnswerDraft(ctx, args)
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session id, no resumability. Each request is
    // independent, which is required on serverless hosting.
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
  }
}

export async function GET(): Promise<Response> {
  return NextResponse.json(
    { error: "Method not allowed: this MCP server only accepts POST" },
    { status: 405 }
  );
}

export async function DELETE(): Promise<Response> {
  return NextResponse.json(
    { error: "Method not allowed: this MCP server only accepts POST" },
    { status: 405 }
  );
}
