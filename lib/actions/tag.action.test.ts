/**
 * Tests for lib/actions/tag.action.ts. Models are mocked; the tests
 * assert the search/filter/sort shapes, pagination, the tag-page
 * population and the popularity aggregation.
 *
 * NOTE: `getTopInteractedTags` is intentionally NOT tested — it
 * returns hardcoded placeholder tags (`tag1`/`tag2`) for every user
 * while `components/cards/UserCard.tsx` renders its result. That is
 * recorded as a bug in the PR body; a test asserting the placeholder
 * would only enshrine it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TAG_ID, chainable } from "./test-helpers";

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
    connect: vi.fn(),
  };
});

vi.mock("@/database/question.model", () => ({ default: mocks.question }));
vi.mock("@/database/tag.model", () => ({ default: mocks.tag }));
vi.mock("@/database/user.model", () => ({ default: mocks.user }));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: mocks.connect }));

import {
  getAllTags,
  getQuesionsByTagId,
  getTopPopularTags,
} from "./tag.action";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
});

function tagDoc(name = "react"): { _id: string; name: string } {
  return { _id: TAG_ID, name };
}

describe("getAllTags", () => {
  it("searches tags by name case-insensitively", async () => {
    mocks.tag.countDocuments.mockResolvedValue(1);
    mocks.tag.find.mockReturnValue(chainable([tagDoc()]));

    await getAllTags({ searchQuery: "reac" });

    expect(mocks.tag.find).toHaveBeenCalledWith({
      $or: [{ name: { $regex: new RegExp("reac", "i") } }],
    });
  });

  // BUG (tag.action.ts, getAllTags): the search term is interpolated
  // raw into `new RegExp(searchQuery, "i")`, so a term with regex
  // syntax (e.g. "([") throws a SyntaxError instead of searching
  // literally. The term must be escaped before use.
  it.skip("treats a regex-syntax search term as literal text", async () => {
    mocks.tag.countDocuments.mockResolvedValue(0);
    mocks.tag.find.mockReturnValue(chainable([]));

    await expect(getAllTags({ searchQuery: "([" })).resolves.toEqual({
      tags: [],
      isNext: false,
    });
  });

  it("sorts popular by question count, recent/old by date, name alphabetically", async () => {
    mocks.tag.countDocuments.mockResolvedValue(0);
    mocks.tag.find.mockImplementation(() => chainable([]));

    await getAllTags({ filter: "popular" });
    await getAllTags({ filter: "recent" });
    await getAllTags({ filter: "name" });
    await getAllTags({ filter: "old" });

    const sorts = mocks.tag.find.mock.results.map(
      (r) =>
        (r.value as ReturnType<typeof chainable>).sort.mock.calls[0][0] as Record<
          string,
          number
        >,
    );
    expect(sorts).toEqual([
      { questions: -1 },
      { createdAt: -1 },
      { name: 1 },
      { createdAt: 1 },
    ]);
  });

  it("paginates and reports isNext from the total count", async () => {
    mocks.tag.countDocuments.mockResolvedValue(25);
    mocks.tag.find.mockReturnValue(chainable([tagDoc()]));

    const result = await getAllTags({ page: 2, pageSize: 10 });

    const query = mocks.tag.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(result.isNext).toBe(true);
  });
});

describe("getQuesionsByTagId", () => {
  it("throws when the tag does not exist", async () => {
    mocks.tag.findOne.mockReturnValue(chainable(null));

    await expect(
      getQuesionsByTagId({ tagId: TAG_ID }),
    ).rejects.toThrow("Tag not found");
  });

  it("returns the tag's questions newest-first with a +1 fetch for isNext", async () => {
    const questions = [{ _id: "507f1f77bcf86cd799439099", title: "Q1" }];
    const tag = { ...tagDoc(), questions };
    mocks.tag.findOne.mockReturnValue(chainable(tag));

    const result = await getQuesionsByTagId({ tagId: TAG_ID });

    expect(mocks.tag.findOne).toHaveBeenCalledWith({ _id: TAG_ID });
    const query = mocks.tag.findOne.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.populate).toHaveBeenCalledWith({
      path: "questions",
      model: mocks.question,
      match: {},
      options: { sort: { createdAt: -1 }, skip: 0, limit: 11 },
      populate: [
        { path: "tags", model: mocks.tag, select: "_id name" },
        { path: "author", model: mocks.user, select: "_id clerkId name picture" },
      ],
    });
    expect(result).toEqual({
      tagTitle: "react",
      questions,
      isNext: false,
    });
  });

  it("filters the tag's questions by title when a search query is given", async () => {
    const tag = { ...tagDoc(), questions: [] };
    mocks.tag.findOne.mockReturnValue(chainable(tag));

    await getQuesionsByTagId({ tagId: TAG_ID, searchQuery: "state" });

    const query = mocks.tag.findOne.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.populate).toHaveBeenCalledWith(
      expect.objectContaining({
        match: { title: { $regex: "state", $options: "i" } },
      }),
    );
  });

  it("reports isNext when the tag holds more than one page of questions", async () => {
    const questions = Array.from({ length: 11 }, (_, i) => ({
      _id: `507f1f77bcf86cd7994391${String(i).padStart(2, "0")}`,
      title: `Q${i}`,
    }));
    const tag = { ...tagDoc(), questions };
    mocks.tag.findOne.mockReturnValue(chainable(tag));

    const result = await getQuesionsByTagId({ tagId: TAG_ID, pageSize: 10 });

    expect(result.isNext).toBe(true);
  });
});

describe("getTopPopularTags", () => {
  it("ranks tags by question count and returns the top 5", async () => {
    const popular = [{ name: "react", numberOfQuestions: 42 }];
    mocks.tag.aggregate.mockResolvedValue(popular);

    await expect(getTopPopularTags()).resolves.toBe(popular);

    expect(mocks.tag.aggregate).toHaveBeenCalledWith([
      {
        $project: {
          name: 1,
          numberOfQuestions: { $size: "$questions" },
        },
      },
      { $sort: { numberOfQuestions: -1 } },
      { $limit: 5 },
    ]);
  });
});
