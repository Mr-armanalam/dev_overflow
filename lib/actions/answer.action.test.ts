/**
 * Tests for lib/actions/answer.action.ts. Models, Clerk auth
 * (`@/lib/auth`), `next/cache`, the RAG index hook and the AI-draft
 * marker are mocked; the tests assert the exact queries/updates, the
 * ownership checks, and the reputation rules — including the
 * AI-assisted no-reputation policy.
 *
 * Known bugs these tests expose are recorded in the PR body and NOT
 * fixed here. The tests that pin the correct behaviour are
 * `it.skip`ped with a comment naming the bug; the suite stays green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_ID,
  AUTHOR_ID,
  OTHER_USER_ID,
  QUESTION_ID,
  TAG_ID,
  chainable,
  fakeUser,
} from "./test-helpers";

const mocks = vi.hoisted(() => {
  const model = () => ({
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
    create: vi.fn(),
    countDocuments: vi.fn(),
    deleteOne: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
  });
  return {
    question: model(),
    user: model(),
    answer: model(),
    interaction: model(),
    auth: vi.fn(),
    connect: vi.fn(),
    revalidate: vi.fn(),
    indexAnswer: vi.fn(),
    markAiDraftUsed: vi.fn(),
  };
});

vi.mock("@/database/question.model", () => ({ default: mocks.question }));
vi.mock("@/database/user.model", () => ({ default: mocks.user }));
vi.mock("@/database/answer.model", () => ({ default: mocks.answer }));
vi.mock("@/database/interaction.model", () => ({
  default: mocks.interaction,
}));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: mocks.connect }));
vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: mocks.auth,
  isSameId: (a: unknown, b: unknown) => String(a) === String(b),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/ai/rag/index", () => ({ indexAnswer: mocks.indexAnswer }));
vi.mock("@/lib/ai/drafts", () => ({
  markAiDraftUsed: mocks.markAiDraftUsed,
}));

import {
  createAnswer,
  downvoteAnswer,
  getAnswers,
  upvoteAnswer,
} from "./answer.action";

const author = fakeUser();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(author);
  mocks.connect.mockResolvedValue(undefined);
});

function answerDoc(overrides?: {
  _id?: string;
  author?: string;
  question?: string;
}): { _id: string; author: string; question: string } {
  return {
    _id: ANSWER_ID,
    author: AUTHOR_ID,
    question: QUESTION_ID,
    ...overrides,
  };
}

describe("createAnswer", () => {
  it("creates the answer, links it to the question, records the interaction and grants +10 reputation", async () => {
    mocks.answer.create.mockResolvedValue({ _id: ANSWER_ID });
    mocks.question.findByIdAndUpdate.mockResolvedValue({
      _id: QUESTION_ID,
      tags: [TAG_ID],
    });
    mocks.interaction.create.mockResolvedValue({});
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await createAnswer({
      content: "x".repeat(120),
      question: QUESTION_ID,
      path: "/question/1",
    });

    expect(mocks.answer.create).toHaveBeenCalledWith({
      content: "x".repeat(120),
      author: AUTHOR_ID,
      question: QUESTION_ID,
      aiAssisted: false,
    });
    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $push: { answers: ANSWER_ID } },
    );
    expect(mocks.interaction.create).toHaveBeenCalledWith({
      user: AUTHOR_ID,
      action: "answer",
      question: QUESTION_ID,
      answer: ANSWER_ID,
      tags: [TAG_ID],
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenCalledWith(AUTHOR_ID, {
      $inc: { reputation: 10 },
    });
    expect(mocks.markAiDraftUsed).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/question/1");
    expect(mocks.indexAnswer).toHaveBeenCalledWith(ANSWER_ID, AUTHOR_ID);
  });

  it("grants no reputation for an AI-assisted answer and marks the draft used", async () => {
    mocks.answer.create.mockResolvedValue({ _id: ANSWER_ID });
    mocks.question.findByIdAndUpdate.mockResolvedValue({
      _id: QUESTION_ID,
      tags: [TAG_ID],
    });
    mocks.interaction.create.mockResolvedValue({});
    mocks.markAiDraftUsed.mockResolvedValue(undefined);

    await createAnswer({
      content: "x".repeat(120),
      question: QUESTION_ID,
      path: "/question/1",
      aiAssisted: true,
    });

    expect(mocks.user.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(mocks.markAiDraftUsed).toHaveBeenCalledWith({
      userId: AUTHOR_ID,
      questionId: QUESTION_ID,
    });
  });

  // Fixed bug (answer.action.ts, createAnswer): when the question does not
  // exist, `Question.findByIdAndUpdate` resolves null and the next
  // line reads `questionObject.tags`, throwing a bare TypeError
  // instead of a clean "Question not found".
  it("rejects with 'Question not found' when the question does not exist", async () => {
    mocks.answer.create.mockResolvedValue({ _id: ANSWER_ID });
    mocks.question.findByIdAndUpdate.mockResolvedValue(null);

    await expect(
      createAnswer({
        content: "x".repeat(120),
        question: QUESTION_ID,
        path: "/question/1",
      }),
    ).rejects.toThrow("Question not found");
  });
});

describe("getAnswers", () => {
  it("sorts by highest upvotes by default pagination", async () => {
    const answers = [answerDoc()];
    mocks.answer.find.mockReturnValue(chainable(answers));
    mocks.answer.countDocuments.mockResolvedValue(1);

    const result = await getAnswers({
      questionId: QUESTION_ID,
      sortBy: "highestUpvotes",
    });

    expect(mocks.answer.find).toHaveBeenCalledWith({ question: QUESTION_ID });
    const query = mocks.answer.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.sort).toHaveBeenCalledWith({ upvotes: -1 });
    expect(query.skip).toHaveBeenCalledWith(0);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(query.populate).toHaveBeenCalledWith({
      path: "author",
      model: mocks.user,
      select: "_id clerkId name picture",
    });
    expect(result).toEqual({ answers, isNext: false });
  });

  it("supports the other sort orders", async () => {
    mocks.answer.find.mockImplementation(() => chainable([]));
    mocks.answer.countDocuments.mockResolvedValue(0);

    await getAnswers({ questionId: QUESTION_ID, sortBy: "lowestUpvotes" });
    await getAnswers({ questionId: QUESTION_ID, sortBy: "recent" });
    await getAnswers({ questionId: QUESTION_ID, sortBy: "old" });

    const sorts = mocks.answer.find.mock.results.map(
      (r) =>
        (
          r.value as ReturnType<typeof chainable>
        ).sort.mock.calls[0][0] as Record<string, number>,
    );
    expect(sorts).toEqual([
      { upvotes: 1 },
      { createdAt: -1 },
      { createdAt: 1 },
    ]);
  });

  it("paginates and reports isNext from the total count", async () => {
    mocks.answer.find.mockReturnValue(chainable([answerDoc()]));
    mocks.answer.countDocuments.mockResolvedValue(25);

    const result = await getAnswers({
      questionId: QUESTION_ID,
      page: 3,
      pageSize: 10,
    });

    const query = mocks.answer.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.skip).toHaveBeenCalledWith(20);
    expect(result.isNext).toBe(true);
  });
});

describe("upvoteAnswer", () => {
  it("throws when the answer does not exist", async () => {
    mocks.answer.findById.mockReturnValue(chainable(null));

    await expect(
      upvoteAnswer({
        answerId: ANSWER_ID,
        hasupVoted: false,
        hasdownVoted: false,
        path: "/",
      }),
    ).rejects.toThrow("Answer not found");
  });

  it("returns an error without writing when the author votes on their own answer", async () => {
    mocks.answer.findById.mockReturnValue(chainable(answerDoc()));

    const result = await upvoteAnswer({
      answerId: ANSWER_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(result).toEqual({
      success: false,
      error: "You cannot vote on your own answer",
    });
    expect(mocks.answer.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("adds an upvote and grants +2 to the voter and +10 to the author", async () => {
    mocks.answer.findById.mockReturnValue(
      chainable(answerDoc({ author: OTHER_USER_ID })),
    );
    mocks.answer.findByIdAndUpdate.mockResolvedValue(
      answerDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    const result = await upvoteAnswer({
      answerId: ANSWER_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(result).toEqual({ success: true });
    expect(mocks.answer.findByIdAndUpdate).toHaveBeenCalledWith(
      ANSWER_ID,
      { $addToSet: { upvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(1, AUTHOR_ID, {
      $inc: { reputation: 2 },
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      { $inc: { reputation: 10 } },
    );
  });

  it("removes an upvote and refunds the reputation", async () => {
    mocks.answer.findById.mockReturnValue(
      chainable(answerDoc({ author: OTHER_USER_ID })),
    );
    mocks.answer.findByIdAndUpdate.mockResolvedValue(
      answerDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await upvoteAnswer({
      answerId: ANSWER_ID,
      hasupVoted: true,
      hasdownVoted: false,
      path: "/",
    });

    expect(mocks.answer.findByIdAndUpdate).toHaveBeenCalledWith(
      ANSWER_ID,
      { $pull: { upvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(1, AUTHOR_ID, {
      $inc: { reputation: -2 },
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      { $inc: { reputation: -10 } },
    );
  });

  it("switches a downvote to an upvote", async () => {
    mocks.answer.findById.mockReturnValue(
      chainable(answerDoc({ author: OTHER_USER_ID })),
    );
    mocks.answer.findByIdAndUpdate.mockResolvedValue(
      answerDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await upvoteAnswer({
      answerId: ANSWER_ID,
      hasupVoted: false,
      hasdownVoted: true,
      path: "/",
    });

    expect(mocks.answer.findByIdAndUpdate).toHaveBeenCalledWith(
      ANSWER_ID,
      { $pull: { downvotes: AUTHOR_ID }, $push: { upvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
  });
});

describe("downvoteAnswer", () => {
  it("throws when the answer does not exist", async () => {
    mocks.answer.findById.mockReturnValue(chainable(null));

    await expect(
      downvoteAnswer({
        answerId: ANSWER_ID,
        hasupVoted: false,
        hasdownVoted: false,
        path: "/",
      }),
    ).rejects.toThrow("Answer not found");
  });

  it("returns an error without writing when the author votes on their own answer", async () => {
    mocks.answer.findById.mockReturnValue(chainable(answerDoc()));

    const result = await downvoteAnswer({
      answerId: ANSWER_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(result).toEqual({
      success: false,
      error: "You cannot vote on your own answer",
    });
    expect(mocks.answer.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("charges the voter -2 and the author -10 for a fresh downvote", async () => {
    mocks.answer.findById.mockReturnValue(
      chainable(answerDoc({ author: OTHER_USER_ID })),
    );
    mocks.answer.findByIdAndUpdate.mockResolvedValue(
      answerDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    const result = await downvoteAnswer({
      answerId: ANSWER_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(result).toEqual({ success: true });
    expect(mocks.answer.findByIdAndUpdate).toHaveBeenCalledWith(
      ANSWER_ID,
      { $addToSet: { downvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(1, AUTHOR_ID, {
      $inc: { reputation: -2 },
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      { $inc: { reputation: -10 } },
    );
  });

  it("refunds the voter +2 and the author +10 when a downvote is removed", async () => {
    mocks.answer.findById.mockReturnValue(
      chainable(answerDoc({ author: OTHER_USER_ID })),
    );
    mocks.answer.findByIdAndUpdate.mockResolvedValue(
      answerDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await downvoteAnswer({
      answerId: ANSWER_ID,
      hasupVoted: false,
      hasdownVoted: true,
      path: "/",
    });

    expect(mocks.answer.findByIdAndUpdate).toHaveBeenCalledWith(
      ANSWER_ID,
      { $pull: { downvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(1, AUTHOR_ID, {
      $inc: { reputation: 2 },
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      { $inc: { reputation: 10 } },
    );
  });

  it("switches an upvote to a downvote", async () => {
    mocks.answer.findById.mockReturnValue(
      chainable(answerDoc({ author: OTHER_USER_ID })),
    );
    mocks.answer.findByIdAndUpdate.mockResolvedValue(
      answerDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await downvoteAnswer({
      answerId: ANSWER_ID,
      hasupVoted: true,
      hasdownVoted: false,
      path: "/",
    });

    expect(mocks.answer.findByIdAndUpdate).toHaveBeenCalledWith(
      ANSWER_ID,
      { $pull: { upvotes: AUTHOR_ID }, $push: { downvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
  });
});
