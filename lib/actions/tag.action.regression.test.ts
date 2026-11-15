/**
 * Regression tests for the tag-action defects fixed in the
 * four-defects PR:
 * - getTopInteractedTags returned a hardcoded [{tag1}, {tag2}] stub;
 * - search terms were interpolated raw into RegExp.
 * Mocked models — no database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUser, mockInteraction, mockTag } = vi.hoisted(() => ({
  mockUser: { findById: vi.fn() },
  mockInteraction: { aggregate: vi.fn() },
  mockTag: { find: vi.fn(), countDocuments: vi.fn() },
}));

vi.mock("@/database/user.model", () => ({ default: mockUser }));
vi.mock("@/database/interaction.model", () => ({
  default: mockInteraction,
}));
vi.mock("@/database/tag.model", () => ({ default: mockTag }));
vi.mock("@/database/question.model", () => ({ default: {} }));
vi.mock("../mongoose", () => ({
  connectToDatabase: vi.fn(() => Promise.resolve()),
}));

import { getAllTags, getTopInteractedTags } from "./tag.action";

describe("getTopInteractedTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.findById.mockResolvedValue({ _id: "user-1" });
  });

  it("returns the user's real tags, most-interacted first", async () => {
    mockInteraction.aggregate.mockResolvedValue([
      { _id: "tag-2", count: 5 },
      { _id: "tag-1", count: 2 },
    ]);
    // Database order is deliberately different from interaction order.
    mockTag.find.mockReturnValue({
      select: vi.fn().mockResolvedValue([
        { _id: "tag-1", name: "react" },
        { _id: "tag-2", name: "node" },
      ]),
    });

    const tags = await getTopInteractedTags({ userId: "user-1" });

    expect(tags).toEqual([
      { _id: "tag-2", name: "node" },
      { _id: "tag-1", name: "react" },
    ]);
    expect(tags.map((tag) => tag.name)).not.toContain("tag1");
    expect(tags.map((tag) => tag.name)).not.toContain("tag2");
  });

  it("returns an empty array when the user has no interactions", async () => {
    mockInteraction.aggregate.mockResolvedValue([]);

    const tags = await getTopInteractedTags({ userId: "user-1" });

    expect(tags).toEqual([]);
    expect(mockTag.find).not.toHaveBeenCalled();
  });

  it("throws when the user does not exist", async () => {
    mockUser.findById.mockResolvedValue(null);
    await expect(getTopInteractedTags({ userId: "missing" })).rejects.toThrow(
      "User not found"
    );
  });

  it("respects the caller's limit", async () => {
    mockInteraction.aggregate.mockResolvedValue([]);
    await getTopInteractedTags({ userId: "user-1", limit: 1 });
    const pipeline = mockInteraction.aggregate.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(pipeline).toContainEqual({ $limit: 1 });
  });
});

describe("getAllTags search", () => {
  it("escapes regex syntax in the search term", async () => {
    mockTag.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    mockTag.countDocuments.mockResolvedValue(0);

    await getAllTags({ searchQuery: "c++" });

    const query = mockTag.find.mock.calls[0][0] as {
      $or: Array<{ name: { $regex: RegExp } }>;
    };
    expect(query.$or[0].name.$regex.source).toBe("c\\+\\+");
  });
});
