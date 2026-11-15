/**
 * Tests for lib/auth.ts: `isSameId` (pure) and `getAuthenticatedUser`
 * (Clerk session -> Mongo user). Clerk's `auth()` and the User model
 * are mocked; the real `connectToDatabase` is stubbed so no database
 * is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainable, fakeUser } from "./actions/test-helpers";

const mocks = vi.hoisted(() => ({
  clerkAuth: vi.fn(),
  userFindOne: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.clerkAuth }));
vi.mock("@/database/user.model", () => ({
  default: { findOne: mocks.userFindOne },
}));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: mocks.connect }));

import { getAuthenticatedUser, isSameId } from "./auth";

describe("isSameId", () => {
  it("matches identical strings and identical ObjectId string forms", () => {
    expect(isSameId("507f1f77bcf86cd799439011", "507f1f77bcf86cd799439011")).toBe(
      true,
    );
  });

  it("rejects different ids", () => {
    expect(isSameId("507f1f77bcf86cd799439011", "507f1f77bcf86cd799439022")).toBe(
      false,
    );
  });

  it("compares by string value, so an object with the same string matches", () => {
    expect(
      isSameId(
        { toString: () => "507f1f77bcf86cd799439011" },
        "507f1f77bcf86cd799439011",
      ),
    ).toBe(true);
  });
});

describe("getAuthenticatedUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.connect.mockResolvedValue(undefined);
  });

  it("throws Unauthorized when there is no signed-in user", async () => {
    mocks.clerkAuth.mockResolvedValue({ userId: null });

    await expect(getAuthenticatedUser()).rejects.toThrow(
      "Unauthorized: please sign in",
    );
    expect(mocks.userFindOne).not.toHaveBeenCalled();
  });

  it("throws 'User not found' when the Clerk user has not been synced", async () => {
    mocks.clerkAuth.mockResolvedValue({ userId: "clerk_user_1" });
    mocks.userFindOne.mockReturnValue(chainable(null));

    await expect(getAuthenticatedUser()).rejects.toThrow("User not found");
    expect(mocks.userFindOne).toHaveBeenCalledWith({
      clerkId: "clerk_user_1",
    });
  });

  it("returns the Mongo user for a signed-in, synced user", async () => {
    const user = fakeUser();
    mocks.clerkAuth.mockResolvedValue({ userId: "clerk_user_1" });
    mocks.userFindOne.mockReturnValue(chainable(user));

    await expect(getAuthenticatedUser()).resolves.toBe(user);
    expect(mocks.connect).toHaveBeenCalled();
  });
});
