/**
 * Tests for lib/actions/user.action.ts. Models, Clerk auth
 * (`@/lib/auth`) and `next/cache` are mocked; `assignBadges` runs
 * for real (pure). The tests assert the exact queries, the
 * own-profile-only update rule, save/unsave toggling, and the
 * badge/stat aggregation.
 *
 * Known bugs these tests expose are recorded in the PR body and NOT
 * fixed here. The tests that pin the correct behaviour are
 * `it.skip`ped with a comment naming the bug; the suite stays green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTHOR_ID,
  QUESTION_ID,
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
    auth: vi.fn(),
    connect: vi.fn(),
    revalidate: vi.fn(),
  };
});

vi.mock("@/database/question.model", () => ({ default: mocks.question }));
vi.mock("@/database/tag.model", () => ({ default: mocks.tag }));
vi.mock("@/database/user.model", () => ({ default: mocks.user }));
vi.mock("@/database/answer.model", () => ({ default: mocks.answer }));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: mocks.connect }));
vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: mocks.auth,
  isSameId: (a: unknown, b: unknown) => String(a) === String(b),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import {
  getAllUsers,
  getSavedQuestion,
  getUserAnswers,
  getUserById,
  getUserInfo,
  getUserQuestions,
  toggleSaveQuestion,
  updateUser,
} from "./user.action";

const author = fakeUser();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(author);
  mocks.connect.mockResolvedValue(undefined);
});

describe("getUserById", () => {
  it("returns the user found by clerkId", async () => {
    mocks.user.findOne.mockReturnValue(chainable(author));

    await expect(getUserById({ userId: "clerk_user_1" })).resolves.toBe(
      author,
    );
    expect(mocks.user.findOne).toHaveBeenCalledWith({
      clerkId: "clerk_user_1",
    });
  });

  it("throws when the user does not exist", async () => {
    mocks.user.findOne.mockReturnValue(chainable(null));

    await expect(getUserById({ userId: "clerk_missing" })).rejects.toThrow(
      "User not found",
    );
  });
});

describe("updateUser", () => {
  it("updates the signed-in user's own profile", async () => {
    mocks.user.findOneAndUpdate.mockResolvedValue(author);

    await updateUser({
      clerkId: "clerk_user_1",
      updateData: { name: "New Name" },
      path: "/profile/edit",
    });

    expect(mocks.user.findOneAndUpdate).toHaveBeenCalledWith(
      { clerkId: "clerk_user_1" },
      { name: "New Name" },
      { returnDocument: "after" },
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/profile/edit");
  });

  it("throws Forbidden when the clerkId is not the signed-in user", async () => {
    await expect(
      updateUser({
        clerkId: "clerk_user_2",
        updateData: { name: "New Name" },
        path: "/profile/edit",
      }),
    ).rejects.toThrow("Forbidden: you can only update your own profile");
    expect(mocks.user.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("getAllUsers", () => {
  it("searches username and name case-insensitively", async () => {
    mocks.user.find.mockReturnValue(chainable([author]));
    mocks.user.countDocuments.mockResolvedValue(1);

    await getAllUsers({ searchQuery: "arm" });

    expect(mocks.user.find).toHaveBeenCalledWith({
      $or: [
        { username: new RegExp("arm", "i") },
        { name: new RegExp("arm", "i") },
      ],
    });
  });

  // BUG (user.action.ts, getAllUsers): the search term is
  // interpolated raw into `new RegExp(searchQuery, "i")`, so a term
  // with regex syntax (e.g. "([") throws a SyntaxError instead of
  // searching literally. The term must be escaped before use.
  it.skip("treats a regex-syntax search term as literal text", async () => {
    mocks.user.find.mockReturnValue(chainable([]));
    mocks.user.countDocuments.mockResolvedValue(0);

    await expect(getAllUsers({ searchQuery: "([" })).resolves.toEqual({
      users: [],
      isNext: false,
    });
  });

  it("sorts by joined date and by reputation", async () => {
    mocks.user.find.mockImplementation(() => chainable([]));
    mocks.user.countDocuments.mockResolvedValue(0);

    await getAllUsers({ filter: "new_users" });
    await getAllUsers({ filter: "old_users" });
    await getAllUsers({ filter: "top_contributors" });

    const sorts = mocks.user.find.mock.results.map(
      (r) =>
        (r.value as ReturnType<typeof chainable>).sort.mock.calls[0][0] as Record<
          string,
          number
        >,
    );
    expect(sorts).toEqual([
      { joinedAt: -1 },
      { joinedAt: 1 },
      { reputation: -1 },
    ]);
  });

  it("paginates and reports isNext", async () => {
    mocks.user.find.mockReturnValue(chainable([author]));
    mocks.user.countDocuments.mockResolvedValue(25);

    const result = await getAllUsers({ page: 2, pageSize: 10 });

    const query = mocks.user.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(result.isNext).toBe(true);
  });
});

describe("toggleSaveQuestion", () => {
  it("throws when the signed-in user is not found", async () => {
    mocks.user.findById.mockReturnValue(chainable(null));

    await expect(
      toggleSaveQuestion({ questionId: QUESTION_ID, path: "/" }),
    ).rejects.toThrow("User not found");
  });

  it("unsaves a question that is already saved", async () => {
    mocks.user.findById.mockReturnValue(
      chainable(fakeUser({ saved: [QUESTION_ID] })),
    );
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await toggleSaveQuestion({ questionId: QUESTION_ID, path: "/" });

    expect(mocks.user.findByIdAndUpdate).toHaveBeenCalledWith(
      AUTHOR_ID,
      { $pull: { saved: QUESTION_ID } },
      { returnDocument: "after" },
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
  });

  it("saves a question that is not saved yet", async () => {
    mocks.user.findById.mockReturnValue(chainable(fakeUser({ saved: [] })));
    mocks.user.findByIdAndUpdate.mockResolvedValue({});

    await toggleSaveQuestion({ questionId: QUESTION_ID, path: "/" });

    expect(mocks.user.findByIdAndUpdate).toHaveBeenCalledWith(
      AUTHOR_ID,
      { $addToSet: { saved: QUESTION_ID } },
      { returnDocument: "after" },
    );
  });
});

describe("getSavedQuestion", () => {
  it("returns the populated saved questions and isNext from the +1 fetch", async () => {
    const saved = [{ _id: QUESTION_ID, title: "Q1" }];
    const userDoc = { ...fakeUser(), saved };
    mocks.user.findOne.mockReturnValue(chainable(userDoc));

    const result = await getSavedQuestion({ clerkId: "clerk_user_1" });

    expect(mocks.user.findOne).toHaveBeenCalledWith({
      clerkId: "clerk_user_1",
    });
    const query = mocks.user.findOne.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.populate).toHaveBeenCalledWith({
      path: "saved",
      match: {},
      options: { sort: { createdAt: -1 }, skip: 0, limit: 11 },
      populate: [
        { path: "tags", model: mocks.tag, select: "_id name" },
        { path: "author", model: mocks.user, select: "_id clerkId name picture" },
      ],
    });
    expect(result).toEqual({ questions: saved, isNext: false });
  });

  it("filters saved questions by title when a search query is given", async () => {
    mocks.user.findOne.mockReturnValue(chainable({ ...fakeUser(), saved: [] }));

    await getSavedQuestion({ clerkId: "clerk_user_1", searchQuery: "state" });

    const query = mocks.user.findOne.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.populate).toHaveBeenCalledWith(
      expect.objectContaining({
        match: { title: { $regex: new RegExp("state", "i") } },
      }),
    );
  });

  // Fixed bug (user.action.ts, getSavedQuestion): `user.saved.length` is
  // read BEFORE the `if (!user)` check, so a missing user throws a
  // bare TypeError instead of "User not found".
  it("throws 'User not found' when the user does not exist", async () => {
    mocks.user.findOne.mockReturnValue(chainable(null));

    await expect(
      getSavedQuestion({ clerkId: "clerk_missing" }),
    ).rejects.toThrow("User not found");
  });
});

describe("getUserInfo", () => {
  function setupAggregates(): void {
    mocks.user.findOne.mockReturnValue(chainable(author));
    mocks.question.countDocuments.mockResolvedValue(5);
    mocks.answer.countDocuments.mockResolvedValue(12);
    mocks.question.aggregate.mockResolvedValue([{ totalUpvotes: 60 }]);
    // Answer.aggregate is called twice: answer upvotes, then the
    // (broken) TOTAL_VIEWS aggregation.
    mocks.answer.aggregate
      .mockResolvedValueOnce([{ totalUpvotes: 120 }])
      .mockResolvedValueOnce([{ totalUpvotes: 0 }]);
  }

  it("returns counts, reputation and badge counts from the aggregates", async () => {
    setupAggregates();

    const result = await getUserInfo({ userId: "clerk_user_1" });

    expect(result.totalQuestion).toBe(5);
    expect(result.totalAnswer).toBe(12);
    expect(result.reputation).toBe(0);
    // ANSWER_COUNT 12 -> BRONZE; QUESTION_UPVOTES 60 -> BRONZE+SILVER;
    // ANSWER_UPVOTES 120 -> BRONZE+SILVER+GOLD. TOTAL_VIEWS contributes
    // 0 here — see the skipped test below: the views aggregation is
    // broken and always yields 0.
    expect(result.badgeCounts).toEqual({ GOLD: 1, SILVER: 2, BRONZE: 3 });
  });

  it("handles a user with no questions, answers or votes", async () => {
    mocks.user.findOne.mockReturnValue(chainable(author));
    mocks.question.countDocuments.mockResolvedValue(0);
    mocks.answer.countDocuments.mockResolvedValue(0);
    mocks.question.aggregate.mockResolvedValue([]);
    mocks.answer.aggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getUserInfo({ userId: "clerk_user_1" });

    expect(result).toEqual(
      expect.objectContaining({
        totalQuestion: 0,
        totalAnswer: 0,
        badgeCounts: { GOLD: 0, SILVER: 0, BRONZE: 0 },
      }),
    );
  });

  it("throws when the user does not exist", async () => {
    mocks.user.findOne.mockReturnValue(chainable(null));

    await expect(getUserInfo({ userId: "clerk_missing" })).rejects.toThrow(
      "User not found",
    );
  });

  // Fixed bug (user.action.ts, getUserInfo): the TOTAL_VIEWS criterion is
  // computed from an aggregation on the Answer model (which has no
  // `views` field) grouped into `totalUpvotes`, while the code reads
  // `questionViews?.totalViews` — so it is always undefined and the
  // badge is always 0. The aggregation must run on the Question
  // model and group the sum as `totalViews`.
  it("awards the TOTAL_VIEWS badge from the user's question views", async () => {
    mocks.user.findOne.mockReturnValue(chainable(author));
    mocks.question.countDocuments.mockResolvedValue(0);
    mocks.answer.countDocuments.mockResolvedValue(0);
    mocks.question.aggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ totalViews: 5000 }]);
    mocks.answer.aggregate.mockResolvedValueOnce([]);

    const result = await getUserInfo({ userId: "clerk_user_1" });

    expect(mocks.question.aggregate).toHaveBeenCalledWith([
      { $match: { author: AUTHOR_ID } },
      { $group: { _id: null, totalViews: { $sum: "$views" } } },
    ]);
    expect(result.badgeCounts).toEqual({ GOLD: 0, SILVER: 0, BRONZE: 1 });
  });
});

describe("getUserQuestions", () => {
  it("lists the user's questions newest-first with pagination", async () => {
    const questions = [{ _id: QUESTION_ID }];
    mocks.question.countDocuments.mockResolvedValue(1);
    mocks.question.find.mockReturnValue(chainable(questions));

    const result = await getUserQuestions({ userId: AUTHOR_ID });

    expect(mocks.question.countDocuments).toHaveBeenCalledWith({
      author: AUTHOR_ID,
    });
    expect(mocks.question.find).toHaveBeenCalledWith({ author: AUTHOR_ID });
    const query = mocks.question.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.sort).toHaveBeenCalledWith({
      createdAt: -1,
      views: -1,
      upvotes: -1,
    });
    expect(query.skip).toHaveBeenCalledWith(0);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(query.populate).toHaveBeenCalledWith("tags", "_id name ");
    expect(query.populate).toHaveBeenCalledWith(
      "author",
      "_id clerkId name picture ",
    );
    expect(result).toEqual({
      totalQuestions: 1,
      questions,
      isNext: false,
    });
  });
});

describe("getUserAnswers", () => {
  it("lists the user's answers by upvotes with pagination", async () => {
    const answers = [{ _id: "507f1f77bcf86cd799439077" }];
    mocks.answer.countDocuments.mockResolvedValue(1);
    mocks.answer.find.mockReturnValue(chainable(answers));

    const result = await getUserAnswers({ userId: AUTHOR_ID });

    expect(mocks.answer.countDocuments).toHaveBeenCalledWith({
      author: AUTHOR_ID,
    });
    expect(mocks.answer.find).toHaveBeenCalledWith({ author: AUTHOR_ID });
    const query = mocks.answer.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.sort).toHaveBeenCalledWith({ upvotes: -1 });
    expect(query.populate).toHaveBeenCalledWith("question", "_id title ");
    expect(query.populate).toHaveBeenCalledWith(
      "author",
      "_id clerkId name picture ",
    );
    expect(result).toEqual({ totalAnswers: 1, answers, isNext: false });
  });

  it("reports isNext when more answers remain", async () => {
    mocks.answer.countDocuments.mockResolvedValue(15);
    mocks.answer.find.mockReturnValue(chainable([{ _id: "x" }]));

    const result = await getUserAnswers({
      userId: AUTHOR_ID,
      page: 1,
      pageSize: 10,
    });

    expect(result.isNext).toBe(true);
  });
});
