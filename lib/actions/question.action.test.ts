/**
 * Tests for lib/actions/question.action.ts. Mongoose models, Clerk auth
 * (`@/lib/auth`), `next/cache` and the RAG index-on-write hooks are
 * mocked; the tests assert the exact queries/updates issued, the
 * ownership checks, and the reputation deltas.
 *
 * Known bugs these tests expose are recorded in the PR body and NOT
 * fixed here. The tests that pin the correct behaviour are
 * `it.skip`ped with a comment naming the bug; the suite stays green.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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
    tag: model(),
    user: model(),
    answer: model(),
    interaction: model(),
    auth: vi.fn(),
    connect: vi.fn(),
    revalidate: vi.fn(),
    indexQuestion: vi.fn(),
    deleteChunksFor: vi.fn(),
  };
});

vi.mock("@/database/question.model", () => ({ default: mocks.question }));
vi.mock("@/database/tag.model", () => ({ default: mocks.tag }));
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
vi.mock("@/lib/ai/rag/index", () => ({
  indexQuestion: mocks.indexQuestion,
  deleteChunksFor: mocks.deleteChunksFor,
}));

import {
  createQuestion,
  deleteAnswer,
  deleteQuestion,
  editQuestion,
  getHotQuestions,
  getQuestions,
  getQuestionsById,
  getRecommentedQuestions,
  upvoteQuestion,
  downvoteQuestion,
} from "./question.action";

const author = fakeUser();

interface QuestionDoc {
  _id: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
  views: number;
  upvotes: string[];
  downvotes: string[];
  answers: string[];
  save: Mock;
}

function questionDoc(overrides?: Partial<QuestionDoc>): QuestionDoc {
  return {
    _id: QUESTION_ID,
    title: "How do I use useState?",
    content: "x".repeat(120),
    author: AUTHOR_ID,
    tags: [TAG_ID],
    views: 0,
    upvotes: [],
    downvotes: [],
    answers: [],
    save: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(author);
  mocks.connect.mockResolvedValue(undefined);
});

describe("getQuestions", () => {
  it("lists with default pagination and no filter", async () => {
    const questions = [questionDoc()];
    mocks.question.find.mockReturnValue(chainable(questions));
    mocks.question.countDocuments.mockResolvedValue(1);

    const result = await getQuestions({});

    expect(mocks.question.find).toHaveBeenCalledWith({});
    const query = mocks.question.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.skip).toHaveBeenCalledWith(0);
    expect(query.limit).toHaveBeenCalledWith(20);
    expect(query.sort).toHaveBeenCalledWith({});
    expect(query.populate).toHaveBeenCalledWith({
      path: "tags",
      model: mocks.tag,
    });
    expect(query.populate).toHaveBeenCalledWith({
      path: "author",
      model: mocks.user,
    });
    expect(result).toEqual({ questions, isNext: false });
  });

  it("builds a case-insensitive $or search over title and content", async () => {
    mocks.question.find.mockReturnValue(chainable([]));
    mocks.question.countDocuments.mockResolvedValue(0);

    await getQuestions({ searchQuery: "useState" });

    const query = mocks.question.find.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(query.$or).toEqual([
      { title: { $regex: new RegExp("useState", "i") } },
      { content: { $regex: new RegExp("useState", "i") } },
    ]);
  });

  it("sorts newest by createdAt and frequent by views", async () => {
    mocks.question.find.mockImplementation(() => chainable([]));
    mocks.question.countDocuments.mockResolvedValue(0);

    await getQuestions({ filter: "newest" });
    expect(
      (
        mocks.question.find.mock.results[0].value as ReturnType<
          typeof chainable
        >
      ).sort,
    ).toHaveBeenCalledWith({ createdAt: -1 });

    await getQuestions({ filter: "frequent" });
    expect(
      (
        mocks.question.find.mock.results[1].value as ReturnType<
          typeof chainable
        >
      ).sort,
    ).toHaveBeenCalledWith({ views: -1 });
  });

  it("filters unanswered to questions with an empty answers array", async () => {
    mocks.question.find.mockReturnValue(chainable([]));
    mocks.question.countDocuments.mockResolvedValue(0);

    await getQuestions({ filter: "unanswered" });

    expect(mocks.question.find).toHaveBeenCalledWith({
      answers: { $size: 0 },
    });
  });

  // BUG (question.action.ts, getQuestions): the search term is
  // interpolated raw into `new RegExp(searchQuery, "i")`, so a term
  // with regex syntax (e.g. "([") throws a SyntaxError instead of
  // searching literally. The term must be escaped (or the query
  // built without RegExp) before use. Same pattern in
  // tag.action.ts getAllTags, user.action.ts getAllUsers and
  // getSavedQuestion, and getQuesionsByTagId.
  it.skip("treats a regex-syntax search term as literal text", async () => {
    mocks.question.find.mockReturnValue(chainable([]));
    mocks.question.countDocuments.mockResolvedValue(0);

    await expect(getQuestions({ searchQuery: "([" })).resolves.toEqual({
      questions: [],
      isNext: false,
    });
  });

  it("paginates and reports isNext from the total count", async () => {
    const questions = [questionDoc(), questionDoc()];
    mocks.question.find.mockReturnValue(chainable(questions));
    mocks.question.countDocuments.mockResolvedValue(25);

    const result = await getQuestions({ page: 2, pageSize: 10 });

    const query = mocks.question.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(result.isNext).toBe(true);
  });
});

describe("createQuestion", () => {
  it("creates the question, upserts tags case-insensitively, records the interaction and +5 reputation", async () => {
    const tag2 = "507f1f77bcf86cd799439066";
    mocks.question.create.mockResolvedValue({ _id: QUESTION_ID });
    mocks.tag.findOneAndUpdate
      .mockResolvedValueOnce({ _id: TAG_ID })
      .mockResolvedValueOnce({ _id: tag2 });
    mocks.question.findByIdAndUpdate.mockResolvedValue({});
    mocks.interaction.create.mockResolvedValue({});
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    const result = await createQuestion({
      title: "How do I use useState?",
      content: "x".repeat(120),
      tags: ["React", "hooks"],
      path: "/",
    });

    expect(mocks.question.create).toHaveBeenCalledWith({
      title: "How do I use useState?",
      content: "x".repeat(120),
      author: AUTHOR_ID,
    });
    expect(mocks.tag.findOneAndUpdate).toHaveBeenCalledWith(
      { name: { $regex: new RegExp("^React$", "i") } },
      {
        $setOnInsert: { name: "React" },
        $push: { questions: QUESTION_ID },
      },
      { upsert: true, returnDocument: "after" },
    );
    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $push: { tags: { $each: [TAG_ID, tag2] } } },
    );
    expect(mocks.interaction.create).toHaveBeenCalledWith({
      user: AUTHOR_ID,
      action: "ask_question",
      question: QUESTION_ID,
      tags: [TAG_ID, tag2],
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenCalledWith(AUTHOR_ID, {
      $inc: { reputation: 5 },
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
    expect(mocks.indexQuestion).toHaveBeenCalledWith(QUESTION_ID, AUTHOR_ID);
    expect(result).toEqual({ questionId: QUESTION_ID });
  });

  it("works with no tags", async () => {
    mocks.question.create.mockResolvedValue({ _id: QUESTION_ID });
    mocks.question.findByIdAndUpdate.mockResolvedValue({});
    mocks.interaction.create.mockResolvedValue({});
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await createQuestion({
      title: "T?",
      content: "x".repeat(120),
      tags: [],
      path: "/",
    });

    expect(mocks.tag.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [] }),
    );
  });
});

describe("getQuestionsById", () => {
  it("populates tags and author with the selected fields", async () => {
    const doc = questionDoc();
    mocks.question.findById.mockReturnValue(chainable(doc));

    await expect(getQuestionsById({ questionId: QUESTION_ID })).resolves.toBe(
      doc,
    );

    expect(mocks.question.findById).toHaveBeenCalledWith(QUESTION_ID);
    const query = mocks.question.findById.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.populate).toHaveBeenCalledWith({
      path: "tags",
      model: mocks.tag,
      select: "_id name",
    });
    expect(query.populate).toHaveBeenCalledWith({
      path: "author",
      model: mocks.user,
      select: "_id clerkId name picture",
    });
  });
});

describe("upvoteQuestion", () => {
  it("throws when the question does not exist", async () => {
    mocks.question.findById.mockReturnValue(chainable(null));

    await expect(
      upvoteQuestion({
        questionId: QUESTION_ID,
        hasupVoted: false,
        hasdownVoted: false,
        path: "/",
      }),
    ).rejects.toThrow("Question not found");
  });

  it("returns an error without writing when the author votes on their own question", async () => {
    mocks.question.findById.mockReturnValue(chainable(questionDoc()));

    const result = await upvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(result).toEqual({
      success: false,
      error: "You cannot vote on your own question",
    });
    expect(mocks.question.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(mocks.user.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("adds an upvote and grants +1 to the voter and +10 to the author", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );
    mocks.question.findByIdAndUpdate.mockResolvedValue(
      questionDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    const result = await upvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/question/1",
    });

    expect(result).toEqual({ success: true });
    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $addToSet: { upvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(1, AUTHOR_ID, {
      $inc: { reputation: 1 },
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      { $inc: { reputation: 10 } },
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/question/1");
  });

  it("removes an upvote and refunds the reputation", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );
    mocks.question.findByIdAndUpdate.mockResolvedValue(
      questionDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await upvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: true,
      hasdownVoted: false,
      path: "/",
    });

    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $pull: { upvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(1, AUTHOR_ID, {
      $inc: { reputation: -1 },
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      { $inc: { reputation: -10 } },
    );
  });

  it("switches a downvote to an upvote", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );
    mocks.question.findByIdAndUpdate.mockResolvedValue(
      questionDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await upvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: false,
      hasdownVoted: true,
      path: "/",
    });

    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $pull: { downvotes: AUTHOR_ID }, $push: { upvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
  });
});

describe("downvoteQuestion", () => {
  it("throws when the question does not exist", async () => {
    mocks.question.findById.mockReturnValue(chainable(null));

    await expect(
      downvoteQuestion({
        questionId: QUESTION_ID,
        hasupVoted: false,
        hasdownVoted: false,
        path: "/",
      }),
    ).rejects.toThrow("Question not found");
  });

  it("adds a downvote to a fresh question", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );
    mocks.question.findByIdAndUpdate.mockResolvedValue(
      questionDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    const result = await downvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(result).toEqual({ success: true });
    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $addToSet: { downvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
  });

  it("removes an existing downvote", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );
    mocks.question.findByIdAndUpdate.mockResolvedValue(
      questionDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await downvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: false,
      hasdownVoted: true,
      path: "/",
    });

    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $pull: { downvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
  });

  it("switches an upvote to a downvote", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );
    mocks.question.findByIdAndUpdate.mockResolvedValue(
      questionDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await downvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: true,
      hasdownVoted: false,
      path: "/",
    });

    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $pull: { upvotes: AUTHOR_ID }, $push: { downvotes: AUTHOR_ID } },
      { returnDocument: "after" },
    );
  });

  // BUG (question.action.ts, downvoteQuestion): the reputation deltas
  // are inverted relative to downvoteAnswer. A fresh downvote currently
  // grants the voter +2 and the author +10; removing a downvote costs
  // the author -10 instead of refunding +10. Correct behaviour is the
  // mirror of downvoteAnswer: fresh downvote -2/-10, removal +2/+10.
  it.skip("charges the voter -2 and the author -10 for a fresh downvote", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );
    mocks.question.findByIdAndUpdate.mockResolvedValue(
      questionDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await downvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(1, AUTHOR_ID, {
      $inc: { reputation: -2 },
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      { $inc: { reputation: -10 } },
    );
  });

  it.skip("refunds the voter +2 and the author +10 when a downvote is removed", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );
    mocks.question.findByIdAndUpdate.mockResolvedValue(
      questionDoc({ author: OTHER_USER_ID }),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await downvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: false,
      hasdownVoted: true,
      path: "/",
    });

    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(1, AUTHOR_ID, {
      $inc: { reputation: 2 },
    });
    expect(mocks.user.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      { $inc: { reputation: 10 } },
    );
  });

  // BUG (question.action.ts, downvoteQuestion): a self-vote throws
  // instead of returning { success: false, error } like upvoteQuestion
  // and both answer vote actions do — the client shows a full-screen
  // runtime-error overlay instead of a toast.
  it.skip("returns an error without writing when the author downvotes their own question", async () => {
    mocks.question.findById.mockReturnValue(chainable(questionDoc()));

    const result = await downvoteQuestion({
      questionId: QUESTION_ID,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(result).toEqual({
      success: false,
      error: "You cannot vote on your own question",
    });
    expect(mocks.question.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteQuestion", () => {
  it("throws when the question does not exist", async () => {
    mocks.question.findById.mockReturnValue(chainable(null));

    await expect(
      deleteQuestion({ questionId: QUESTION_ID, path: "/" }),
    ).rejects.toThrow("Question not found");
  });

  it("throws Forbidden when a non-author tries to delete", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );

    await expect(
      deleteQuestion({ questionId: QUESTION_ID, path: "/" }),
    ).rejects.toThrow("Forbidden: only the author can delete this question");
    expect(mocks.question.deleteOne).not.toHaveBeenCalled();
  });

  it("deletes the question, its answers and interactions, and drops its RAG chunks", async () => {
    mocks.question.findById.mockReturnValue(chainable(questionDoc()));
    mocks.question.deleteOne.mockResolvedValue({ deletedCount: 1 });
    mocks.answer.deleteMany.mockResolvedValue({ deletedCount: 2 });
    mocks.interaction.deleteMany.mockResolvedValue({ deletedCount: 3 });
    mocks.tag.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await deleteQuestion({ questionId: QUESTION_ID, path: "/" });

    expect(mocks.question.deleteOne).toHaveBeenCalledWith({
      _id: QUESTION_ID,
    });
    expect(mocks.answer.deleteMany).toHaveBeenCalledWith({
      question: QUESTION_ID,
    });
    expect(mocks.interaction.deleteMany).toHaveBeenCalledWith({
      question: QUESTION_ID,
    });
    expect(mocks.deleteChunksFor).toHaveBeenCalledWith(QUESTION_ID);
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
  });

  // BUG (question.action.ts, deleteQuestion): the tag cleanup filters
  // on `{ question: questionId }`, but the Tag schema field is
  // `questions` (plural) — the update matches nothing and the deleted
  // question id stays in tags' `questions` arrays.
  it.skip("removes the deleted question from its tags' question lists", async () => {
    mocks.question.findById.mockReturnValue(chainable(questionDoc()));
    mocks.question.deleteOne.mockResolvedValue({ deletedCount: 1 });
    mocks.answer.deleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.interaction.deleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.tag.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await deleteQuestion({ questionId: QUESTION_ID, path: "/" });

    expect(mocks.tag.updateMany).toHaveBeenCalledWith(
      { questions: QUESTION_ID },
      { $pull: { questions: QUESTION_ID } },
    );
  });
});

describe("deleteAnswer", () => {
  it("throws when the answer does not exist", async () => {
    mocks.answer.findById.mockReturnValue(chainable(null));

    await expect(
      deleteAnswer({ answerId: ANSWER_ID, path: "/" }),
    ).rejects.toThrow("Answer not found");
  });

  it("throws Forbidden when a non-author tries to delete", async () => {
    mocks.answer.findById.mockReturnValue(
      chainable({ _id: ANSWER_ID, author: OTHER_USER_ID, question: QUESTION_ID }),
    );

    await expect(
      deleteAnswer({ answerId: ANSWER_ID, path: "/" }),
    ).rejects.toThrow("Forbidden: only the author can delete this answer");
    expect(mocks.answer.deleteOne).not.toHaveBeenCalled();
  });

  it("deletes the answer, unlinks it from the question and drops its RAG chunk", async () => {
    mocks.answer.findById.mockReturnValue(
      chainable({ _id: ANSWER_ID, author: AUTHOR_ID, question: QUESTION_ID }),
    );
    mocks.answer.deleteOne.mockResolvedValue({ deletedCount: 1 });
    mocks.question.updateMany.mockResolvedValue({ modifiedCount: 1 });
    mocks.interaction.deleteMany.mockResolvedValue({ deletedCount: 1 });

    await deleteAnswer({ answerId: ANSWER_ID, path: "/" });

    expect(mocks.answer.deleteOne).toHaveBeenCalledWith({ _id: ANSWER_ID });
    expect(mocks.question.updateMany).toHaveBeenCalledWith(
      { _id: QUESTION_ID },
      { $pull: { answers: ANSWER_ID } },
    );
    expect(mocks.interaction.deleteMany).toHaveBeenCalledWith({
      answer: ANSWER_ID,
    });
    expect(mocks.deleteChunksFor).toHaveBeenCalledWith(ANSWER_ID);
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
  });
});

describe("editQuestion", () => {
  it("throws when the question does not exist", async () => {
    mocks.question.findById.mockReturnValue(chainable(null));

    await expect(
      editQuestion({
        questionId: QUESTION_ID,
        title: "New",
        content: "New content",
        path: "/",
      }),
    ).rejects.toThrow("Question not found");
  });

  it("throws Forbidden when a non-author tries to edit", async () => {
    mocks.question.findById.mockReturnValue(
      chainable(questionDoc({ author: OTHER_USER_ID })),
    );

    await expect(
      editQuestion({
        questionId: QUESTION_ID,
        title: "New",
        content: "New content",
        path: "/",
      }),
    ).rejects.toThrow("Forbidden: only the author can edit this question");
  });

  it("saves the new title/content and re-embeds the question for RAG", async () => {
    const doc = questionDoc();
    mocks.question.findById.mockReturnValue(chainable(doc));

    await editQuestion({
      questionId: QUESTION_ID,
      title: "Edited title",
      content: "Edited content",
      path: "/question/1",
    });

    expect(doc.title).toBe("Edited title");
    expect(doc.content).toBe("Edited content");
    expect(doc.save).toHaveBeenCalled();
    expect(mocks.indexQuestion).toHaveBeenCalledWith(QUESTION_ID, AUTHOR_ID);
    expect(mocks.revalidate).toHaveBeenCalledWith("/question/1");
  });
});

describe("getHotQuestions", () => {
  it("returns the 5 most-viewed questions, ties broken by upvotes", async () => {
    const hot = [questionDoc()];
    mocks.question.find.mockReturnValue(chainable(hot));

    await expect(getHotQuestions()).resolves.toBe(hot);

    const query = mocks.question.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(mocks.question.find).toHaveBeenCalledWith({});
    expect(query.sort).toHaveBeenCalledWith({ views: -1, upvotes: -1 });
    expect(query.limit).toHaveBeenCalledWith(5);
  });
});

describe("getRecommentedQuestions", () => {
  it("throws when the user does not exist", async () => {
    mocks.user.findOne.mockReturnValue(chainable(null));

    await expect(
      getRecommentedQuestions({ userId: "clerk_missing" }),
    ).rejects.toThrow("User not found");
  });

  it("recommends questions sharing the user's interacted tags, excluding their own", async () => {
    const userDoc = { _id: AUTHOR_ID, clerkId: "clerk_user_1" };
    const tagA = { _id: TAG_ID };
    const tagB = { _id: "507f1f77bcf86cd799439066" };
    mocks.user.findOne.mockReturnValue(chainable(userDoc));
    mocks.interaction.find.mockReturnValue(
      chainable([{ tags: [tagA, tagB] }, { tags: [tagA] }, {}]),
    );
    const recommended = [questionDoc({ author: OTHER_USER_ID })];
    mocks.question.find.mockReturnValue(chainable(recommended));
    mocks.question.countDocuments.mockResolvedValue(1);

    const result = await getRecommentedQuestions({ userId: "clerk_user_1" });

    expect(mocks.interaction.find).toHaveBeenCalledWith({ user: AUTHOR_ID });
    expect(mocks.question.find).toHaveBeenCalledWith({
      $and: [
        { tags: { $in: [TAG_ID, "507f1f77bcf86cd799439066"] } },
        { author: { $ne: AUTHOR_ID } },
      ],
    });
    const query = mocks.question.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.skip).toHaveBeenCalledWith(0);
    expect(query.limit).toHaveBeenCalledWith(28);
    expect(result).toEqual({ questions: recommended, isNext: false });
  });

  // BUG (question.action.ts, getRecommentedQuestions): the search
  // branch queries `{ $title: ... }` — `$title` is not a field, so a
  // search matches nothing. It should be `title`.
  it.skip("searches recommended questions by title and content", async () => {
    const userDoc = { _id: AUTHOR_ID, clerkId: "clerk_user_1" };
    mocks.user.findOne.mockReturnValue(chainable(userDoc));
    mocks.interaction.find.mockReturnValue(chainable([{ tags: [{ _id: TAG_ID }] }]));
    mocks.question.find.mockReturnValue(chainable([]));
    mocks.question.countDocuments.mockResolvedValue(0);

    await getRecommentedQuestions({
      userId: "clerk_user_1",
      searchQuery: "useState",
    });

    const query = mocks.question.find.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(query.$or).toEqual([
      { title: { $regex: "useState", $options: "i" } },
      { content: { $regex: "useState", $options: "i" } },
    ]);
  });

  // BUG (question.action.ts, getRecommentedQuestions): `isNext` is
  // `total > recommendedQuestions.length` — it ignores `skipAmount`,
  // so from page 2 on it reports a next page whenever the total
  // exceeds one page of results, even on the last page.
  it.skip("reports isNext correctly on later pages", async () => {
    const userDoc = { _id: AUTHOR_ID, clerkId: "clerk_user_1" };
    mocks.user.findOne.mockReturnValue(chainable(userDoc));
    mocks.interaction.find.mockReturnValue(chainable([{ tags: [{ _id: TAG_ID }] }]));
    const page = [questionDoc()];
    mocks.question.find.mockReturnValue(chainable(page));
    mocks.question.countDocuments.mockResolvedValue(29);

    const result = await getRecommentedQuestions({
      userId: "clerk_user_1",
      page: 2,
      pageSize: 28,
    });

    // Total 29, page 2 holds the last 1: there is no next page.
    expect(result.isNext).toBe(false);
  });
});
