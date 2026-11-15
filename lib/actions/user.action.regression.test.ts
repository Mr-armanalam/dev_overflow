/**
 * Regression tests for the user-action defects fixed in the
 * four-defects PR: search terms were interpolated raw into RegExp in
 * getAllUsers and getSavedQuestion. Mocked models — no database, no
 * network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUser } = vi.hoisted(() => ({
  mockUser: { find: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn() },
}));

vi.mock("@/database/user.model", () => ({ default: mockUser }));
vi.mock("@/database/question.model", () => ({ default: {} }));
vi.mock("@/database/tag.model", () => ({ default: {} }));
vi.mock("@/database/answer.model", () => ({ default: {} }));
vi.mock("../mongoose", () => ({
  connectToDatabase: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: vi.fn(),
  isSameId: (a: unknown, b: unknown) => String(a) === String(b),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getAllUsers, getSavedQuestion } from "./user.action";

describe("getAllUsers search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("escapes regex syntax in the search term", async () => {
    mockUser.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    mockUser.countDocuments.mockResolvedValue(0);

    await getAllUsers({ searchQuery: "node (js)" });

    const query = mockUser.find.mock.calls[0][0] as {
      $or: Array<{ username?: RegExp; name?: RegExp }>;
    };
    // getAllUsers stores the RegExp directly as the field value.
    expect(query.$or[0].username?.source).toBe("node \\(js\\)");
    expect(query.$or[1].name?.source).toBe("node \\(js\\)");
  });
});

describe("getSavedQuestion search", () => {
  it("escapes regex syntax in the search term", async () => {
    const populate = vi.fn().mockResolvedValue({ saved: [] });
    mockUser.findOne.mockReturnValue({ populate });

    await getSavedQuestion({ clerkId: "clerk-1", searchQuery: "a[bc" });

    const populateArg = populate.mock.calls[0][0] as {
      match: { title: { $regex: RegExp } };
    };
    expect(populateArg.match.title.$regex.source).toBe("a\\[bc");
  });
});
