/**
 * Regression tests for the question-action defects fixed in the
 * four-defects PR:
 * - downvoteQuestion reputation was inverted (a fresh downvote
 *   REWARDED the voter +2 and the author +10);
 * - getRecommentedQuestions searched `$title`, which is not a MongoDB
 *   operator, and its isNext ignored skipAmount;
 * - search terms were interpolated raw into RegExp.
 * Mocked models + mocked auth — no database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuestion, mockUser, mockGetAuthenticatedUser, mockInteraction } =
  vi.hoisted(() => ({
    mockQuestion: {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      find: vi.fn(),
      countDocuments: vi.fn(),
    },
    mockUser: {
      findByIdAndUpdate: vi.fn(),
      findOne: vi.fn(),
    },
    mockGetAuthenticatedUser: vi.fn(),
    mockInteraction: { find: vi.fn() },
  }));

vi.mock("@/database/question.model", () => ({ default: mockQuestion }));
vi.mock("@/database/user.model", () => ({ default: mockUser }));
vi.mock("@/database/answer.model", () => ({ default: {} }));
vi.mock("@/database/tag.model", () => ({ default: {} }));
vi.mock("@/database/interaction.model", () => ({
  default: mockInteraction,
}));
vi.mock("../mongoose", () => ({
  connectToDatabase: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  isSameId: (a: unknown, b: unknown) => String(a) === String(b),
}));
vi.mock("@/lib/ai/rag/index", () => ({
  indexQuestion: vi.fn(),
  deleteChunksFor: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  downvoteQuestion,
  getQuestions,
  getRecommentedQuestions,
} from "./question.action";

/** Mongoose query chain stub; `terminal` is the method the action awaits. */
function makeChain(result: unknown, terminal: "sort" | "limit") {
  const chain: Record<string, unknown> = {};
  chain.populate = vi.fn(() => chain);
  chain.skip = vi.fn(() => chain);
  chain.limit = vi.fn(() =>
    terminal === "limit" ? Promise.resolve(result) : chain
  );
  chain.sort = vi.fn(() =>
    terminal === "sort" ? Promise.resolve(result) : chain
  );
  return chain;
}

describe("downvoteQuestion reputation", () => {
  const voterId = "voter-1";
  const authorId = "author-1";
  const questionId = "question-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUser.mockResolvedValue({ _id: voterId });
    mockQuestion.findById.mockResolvedValue({
      _id: questionId,
      author: authorId,
    });
    mockQuestion.findByIdAndUpdate.mockResolvedValue({
      _id: questionId,
      author: authorId,
    });
    mockUser.findByIdAndUpdate.mockResolvedValue({});
  });

  /** First reputation update is the voter, second is the author. */
  function reputationDeltas() {
    const calls = mockUser.findByIdAndUpdate.mock.calls;
    expect(calls).toHaveLength(2);
    return {
      voter: calls[0][1].$inc.reputation as number,
      author: calls[1][1].$inc.reputation as number,
    };
  }

  it("a fresh downvote costs the voter 2 and the author 10", async () => {
    const result = await downvoteQuestion({
      questionId,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });
    expect(result).toEqual({ success: true });
    expect(reputationDeltas()).toEqual({ voter: -2, author: -10 });
  });

  it("undoing a downvote refunds the voter 2 and the author 10", async () => {
    await downvoteQuestion({
      questionId,
      hasupVoted: false,
      hasdownVoted: true,
      path: "/",
    });
    expect(reputationDeltas()).toEqual({ voter: 2, author: 10 });
  });

  it("switching from an upvote to a downvote costs the voter 2 and the author 10", async () => {
    await downvoteQuestion({
      questionId,
      hasupVoted: true,
      hasdownVoted: false,
      path: "/",
    });
    expect(reputationDeltas()).toEqual({ voter: -2, author: -10 });
  });
});

describe("getRecommentedQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.findOne.mockResolvedValue({ _id: "user-1", clerkId: "clerk-1" });
    mockInteraction.find.mockReturnValue({
      populate: vi.fn().mockReturnValue({
        exec: vi
          .fn()
          .mockResolvedValue([{ tags: [{ _id: "tag-1" }, { _id: "tag-2" }] }]),
      }),
    });
  });

  function setupRecommended(total: number, pageQuestions: unknown[]) {
    mockQuestion.countDocuments.mockResolvedValue(total);
    mockQuestion.find.mockReturnValue(makeChain(pageQuestions, "limit"));
  }

  function searchOrClause() {
    const query = mockQuestion.find.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    return query.$or as Array<Record<string, Record<string, unknown>>>;
  }

  it("searches the title field, not $title", async () => {
    setupRecommended(1, []);
    await getRecommentedQuestions({ userId: "clerk-1", searchQuery: "react" });
    const orClause = searchOrClause();
    expect(orClause).toHaveLength(2);
    expect(orClause[0]).toHaveProperty("title");
    expect(orClause[0]).not.toHaveProperty("$title");
    expect(orClause[1]).toHaveProperty("content");
  });

  it("escapes regex syntax in the Recommended search term", async () => {
    setupRecommended(1, []);
    await getRecommentedQuestions({
      userId: "clerk-1",
      searchQuery: "react (hooks)",
    });
    const orClause = searchOrClause();
    expect(orClause[0].title.$regex).toBe("react \\(hooks\\)");
    expect(orClause[1].content.$regex).toBe("react \\(hooks\\)");
  });

  it("isNext is false on page 2 when no questions remain after skipping", async () => {
    const pageQuestions = Array.from({ length: 10 }, (_, i) => ({
      _id: `q${i}`,
    }));
    setupRecommended(20, pageQuestions);
    const result = await getRecommentedQuestions({
      userId: "clerk-1",
      page: 2,
      pageSize: 10,
    });
    // 20 total, 10 skipped + 10 shown = nothing left. Before the fix
    // this returned true (20 > 10 shown).
    expect(result.isNext).toBe(false);
  });

  it("isNext is true on page 2 when questions remain after skipping", async () => {
    const pageQuestions = Array.from({ length: 10 }, (_, i) => ({
      _id: `q${i}`,
    }));
    setupRecommended(25, pageQuestions);
    const result = await getRecommentedQuestions({
      userId: "clerk-1",
      page: 2,
      pageSize: 10,
    });
    expect(result.isNext).toBe(true);
  });
});

describe("getQuestions search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("escapes regex syntax in the search term", async () => {
    mockQuestion.find.mockReturnValue(makeChain([], "sort"));
    mockQuestion.countDocuments.mockResolvedValue(0);
    await getQuestions({ searchQuery: "a+b (c)" });
    const query = mockQuestion.find.mock.calls[0][0] as {
      $or: Array<{
        title?: { $regex: RegExp };
        content?: { $regex: RegExp };
      }>;
    };
    expect(query.$or[0].title?.$regex.source).toBe("a\\+b \\(c\\)");
    expect(query.$or[1].content?.$regex.source).toBe("a\\+b \\(c\\)");
  });
});
