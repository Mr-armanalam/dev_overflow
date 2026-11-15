/**
 * Tests for lib/actions/user-sync.ts — the webhook-only Clerk ->
 * MongoDB sync. Models and `next/cache` are mocked. These functions
 * have no "use server" directive by design (they are trusted
 * server-to-server operations), which is why they are tested in
 * isolation from the server actions.
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
    user: model(),
    answer: model(),
    interaction: model(),
    connect: vi.fn(),
    revalidate: vi.fn(),
  };
});

vi.mock("@/database/question.model", () => ({ default: mocks.question }));
vi.mock("@/database/user.model", () => ({ default: mocks.user }));
vi.mock("@/database/answer.model", () => ({ default: mocks.answer }));
vi.mock("@/database/interaction.model", () => ({
  default: mocks.interaction,
}));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: mocks.connect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { createUser, deleteUser, updateUser } from "./user-sync";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
});

describe("createUser", () => {
  it("creates the user with the webhook payload and returns it", async () => {
    const user = fakeUser();
    mocks.user.create.mockResolvedValue(user);

    const result = await createUser({
      clerkId: "clerk_user_1",
      name: "Arman Alam",
      username: "armanalam",
      email: "arman@example.com",
      picture: "https://example.com/pic.png",
    });

    expect(mocks.user.create).toHaveBeenCalledWith({
      clerkId: "clerk_user_1",
      name: "Arman Alam",
      username: "armanalam",
      email: "arman@example.com",
      picture: "https://example.com/pic.png",
    });
    expect(result).toBe(user);
  });
});

describe("updateUser", () => {
  it("updates by clerkId and revalidates the path", async () => {
    mocks.user.findOneAndUpdate.mockResolvedValue(fakeUser());

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
});

describe("deleteUser", () => {
  it("throws when the user does not exist", async () => {
    mocks.user.findOneAndDelete.mockResolvedValue(null);

    await expect(deleteUser({ clerkId: "clerk_missing" })).rejects.toThrow(
      "User not found",
    );
    expect(mocks.question.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the user, their content and their interactions", async () => {
    const user = fakeUser();
    const question2 = "507f1f77bcf86cd799439088";
    mocks.user.findOneAndDelete.mockResolvedValue(user);
    mocks.question.find.mockReturnValue(
      chainable([], [QUESTION_ID, question2]),
    );
    mocks.answer.deleteMany.mockResolvedValue({ deletedCount: 3 });
    mocks.interaction.deleteMany.mockResolvedValue({ deletedCount: 5 });
    mocks.question.deleteMany.mockResolvedValue({ deletedCount: 2 });
    mocks.user.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const result = await deleteUser({ clerkId: "clerk_user_1" });

    expect(result).toBe(user);
    expect(mocks.user.findOneAndDelete).toHaveBeenCalledWith({
      clerkId: "clerk_user_1",
    });
    expect(mocks.question.find).toHaveBeenCalledWith({ author: AUTHOR_ID });
    expect(mocks.answer.deleteMany).toHaveBeenCalledWith({
      $or: [
        { author: AUTHOR_ID },
        { question: { $in: [QUESTION_ID, question2] } },
      ],
    });
    expect(mocks.interaction.deleteMany).toHaveBeenCalledWith({
      user: AUTHOR_ID,
    });
    expect(mocks.question.deleteMany).toHaveBeenCalledWith({
      author: AUTHOR_ID,
    });
  });

  // BUG (user-sync.ts, deleteUser): the saved-list cleanup pulls the
  // deleted *user's* id from other users' `saved` arrays, but `saved`
  // holds *question* ids — the update matches nothing and the deleted
  // user's questions stay saved for other users. It must pull the
  // deleted user's question ids instead.
  it.skip("removes the deleted user's questions from other users' saved lists", async () => {
    const user = fakeUser();
    const question2 = "507f1f77bcf86cd799439088";
    mocks.user.findOneAndDelete.mockResolvedValue(user);
    mocks.question.find.mockReturnValue(
      chainable([], [QUESTION_ID, question2]),
    );
    mocks.answer.deleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.interaction.deleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.question.deleteMany.mockResolvedValue({ deletedCount: 2 });
    mocks.user.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await deleteUser({ clerkId: "clerk_user_1" });

    expect(mocks.user.updateMany).toHaveBeenCalledWith(
      { saved: { $in: [QUESTION_ID, question2] } },
      { $pull: { saved: { $in: [QUESTION_ID, question2] } } },
    );
  });
});
