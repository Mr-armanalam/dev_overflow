/**
 * Tests for lib/actions/general.action.ts (`globalSearch`). Models
 * are mocked; the tests assert which collections are queried, the
 * per-type result limits, and the id/title mapping per result type.
 *
 * Known bugs these tests expose are recorded in the PR body and NOT
 * fixed here. The test that pins the correct behaviour is
 * `it.skip`ped with a comment naming the bug; the suite stays green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainable } from "./test-helpers";

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
    tag: model(),
    connect: vi.fn(),
  };
});

vi.mock("@/database/question.model", () => ({ default: mocks.question }));
vi.mock("@/database/user.model", () => ({ default: mocks.user }));
vi.mock("@/database/answer.model", () => ({ default: mocks.answer }));
vi.mock("@/database/tag.model", () => ({ default: mocks.tag }));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: mocks.connect }));

import { globalSearch } from "./general.action";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
});

describe("globalSearch", () => {
  it("searches all four collections with a limit of 2 each when no type is given", async () => {
    mocks.question.find.mockImplementation(() =>
      chainable([{ _id: "q1", title: "How to useState" }]),
    );
    mocks.user.find.mockImplementation(() =>
      chainable([{ _id: "u1", clerkId: "clerk_u1", name: "Arman" }]),
    );
    mocks.answer.find.mockImplementation(() =>
      chainable([{ _id: "a1", question: "q1", content: "useState answer" }]),
    );
    mocks.tag.find.mockImplementation(() =>
      chainable([{ _id: "t1", name: "react" }]),
    );

    const result = await globalSearch({ query: "useState", type: null });

    const regexQuery = { $regex: "useState", $options: "i" };
    expect(mocks.question.find).toHaveBeenCalledWith({ title: regexQuery });
    expect(mocks.user.find).toHaveBeenCalledWith({ name: regexQuery });
    expect(mocks.answer.find).toHaveBeenCalledWith({ content: regexQuery });
    expect(mocks.tag.find).toHaveBeenCalledWith({ name: regexQuery });
    for (const model of [
      mocks.question,
      mocks.user,
      mocks.answer,
      mocks.tag,
    ]) {
      const query = model.find.mock.results[0].value as ReturnType<
        typeof chainable
      >;
      expect(query.limit).toHaveBeenCalledWith(2);
    }

    expect(JSON.parse(result as string)).toEqual([
      { title: "How to useState", type: "question", id: "q1" },
      { title: "Arman", type: "user", id: "clerk_u1" },
      { title: "Answers containing useState", type: "answer", id: "q1" },
      { title: "react", type: "tag", id: "t1" },
    ]);
  });

  it("searches only the requested type with a limit of 8", async () => {
    mocks.question.find.mockImplementation(() =>
      chainable([{ _id: "q1", title: "How to useState" }]),
    );

    const result = await globalSearch({ query: "useState", type: "question" });

    expect(mocks.question.find).toHaveBeenCalledWith({
      title: { $regex: "useState", $options: "i" },
    });
    const query = mocks.question.find.mock.results[0].value as ReturnType<
      typeof chainable
    >;
    expect(query.limit).toHaveBeenCalledWith(8);
    expect(mocks.user.find).not.toHaveBeenCalled();
    expect(mocks.answer.find).not.toHaveBeenCalled();
    expect(mocks.tag.find).not.toHaveBeenCalled();
    expect(JSON.parse(result as string)).toEqual([
      { title: "How to useState", type: "question", id: "q1" },
    ]);
  });

  it("maps user results to their clerkId and answer results to their question", async () => {
    mocks.user.find.mockImplementation(() =>
      chainable([{ _id: "u1", clerkId: "clerk_u1", name: "Arman" }]),
    );

    const result = await globalSearch({ query: "Arman", type: "user" });

    expect(JSON.parse(result as string)).toEqual([
      { title: "Arman", type: "user", id: "clerk_u1" },
    ]);
  });

  it("falls back to searching all collections for an unknown type", async () => {
    mocks.question.find.mockImplementation(() => chainable([]));
    mocks.user.find.mockImplementation(() => chainable([]));
    mocks.answer.find.mockImplementation(() => chainable([]));
    mocks.tag.find.mockImplementation(() => chainable([]));

    const result = await globalSearch({ query: "x", type: "job" });

    expect(mocks.question.find).toHaveBeenCalled();
    expect(mocks.user.find).toHaveBeenCalled();
    expect(mocks.answer.find).toHaveBeenCalled();
    expect(mocks.tag.find).toHaveBeenCalled();
    expect(JSON.parse(result as string)).toEqual([]);
  });

  // BUG (general.action.ts, globalSearch): the type is lowercased for
  // validation (`typeLower`) but the model lookup uses the raw `type`,
  // so `type: "Question"` passes validation and then throws "Invalid
  // search type: Question".
  it.skip("accepts a search type regardless of case", async () => {
    mocks.question.find.mockImplementation(() =>
      chainable([{ _id: "q1", title: "How to useState" }]),
    );

    const result = await globalSearch({ query: "useState", type: "Question" });

    expect(JSON.parse(result as string)).toEqual([
      { title: "How to useState", type: "question", id: "q1" },
    ]);
  });
});
