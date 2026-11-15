/**
 * Tests for lib/actions/interaction.action.ts (`viewQuestion`).
 * Models are mocked. The tests pin the view-counting contract: a
 * view is counted at most once per signed-in user, and anonymous
 * visitors are not counted at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTHOR_ID,
  QUESTION_ID,
  chainable,
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
    interaction: model(),
    connect: vi.fn(),
  };
});

vi.mock("@/database/question.model", () => ({ default: mocks.question }));
vi.mock("@/database/interaction.model", () => ({
  default: mocks.interaction,
}));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: mocks.connect }));

import { viewQuestion } from "./interaction.action";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
});

describe("viewQuestion", () => {
  it("does nothing for an anonymous visitor", async () => {
    await viewQuestion({ questionId: QUESTION_ID, userId: undefined });

    expect(mocks.interaction.findOne).not.toHaveBeenCalled();
    expect(mocks.interaction.create).not.toHaveBeenCalled();
    expect(mocks.question.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("records the view and increments the count on the first view", async () => {
    mocks.interaction.findOne.mockReturnValue(chainable(null));
    mocks.interaction.create.mockResolvedValue({});
    mocks.question.findByIdAndUpdate.mockResolvedValue({});

    await viewQuestion({ questionId: QUESTION_ID, userId: AUTHOR_ID });

    expect(mocks.interaction.findOne).toHaveBeenCalledWith({
      user: AUTHOR_ID,
      action: "view",
      question: QUESTION_ID,
    });
    expect(mocks.interaction.create).toHaveBeenCalledWith({
      user: AUTHOR_ID,
      action: "view",
      question: QUESTION_ID,
    });
    expect(mocks.question.findByIdAndUpdate).toHaveBeenCalledWith(
      QUESTION_ID,
      { $inc: { views: 1 } },
    );
  });

  it("does not count a repeat view by the same user", async () => {
    mocks.interaction.findOne.mockReturnValue(
      chainable({ _id: "507f1f77bcf86cd7994390aa" }),
    );

    await viewQuestion({ questionId: QUESTION_ID, userId: AUTHOR_ID });

    expect(mocks.interaction.create).not.toHaveBeenCalled();
    expect(mocks.question.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
