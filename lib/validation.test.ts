/**
 * Tests for the Zod validation schemas in lib/validation.ts. These are
 * the shapes the ask-question / answer / profile forms validate
 * against, so the boundary values here are the contract.
 *
 * Note: the answer schema is exported as `AnserSchema` (sic) — the
 * typo is pre-existing and left as-is by this test-only change.
 */
import { describe, expect, it } from "vitest";
import { AnserSchema, ProfileSchema, QuestionSchema } from "./validation";

describe("QuestionSchema", () => {
  const valid = {
    title: "How do I use useState in React?",
    explanation: "x".repeat(100),
    tags: ["react", "hooks"],
  };

  it("accepts a valid question", () => {
    expect(QuestionSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a title shorter than 5 characters", () => {
    expect(
      QuestionSchema.safeParse({ ...valid, title: "Hi?" }).success,
    ).toBe(false);
  });

  it("rejects a title longer than 130 characters", () => {
    expect(
      QuestionSchema.safeParse({ ...valid, title: "x".repeat(131) }).success,
    ).toBe(false);
  });

  it("rejects an explanation shorter than 100 characters", () => {
    expect(
      QuestionSchema.safeParse({ ...valid, explanation: "x".repeat(99) })
        .success,
    ).toBe(false);
  });

  it("requires between 1 and 3 tags", () => {
    expect(QuestionSchema.safeParse({ ...valid, tags: [] }).success).toBe(
      false,
    );
    expect(
      QuestionSchema.safeParse({
        ...valid,
        tags: ["a", "b", "c", "d"],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty tag and a tag longer than 15 characters", () => {
    expect(QuestionSchema.safeParse({ ...valid, tags: [""] }).success).toBe(
      false,
    );
    expect(
      QuestionSchema.safeParse({ ...valid, tags: ["x".repeat(16)] }).success,
    ).toBe(false);
  });
});

describe("AnserSchema", () => {
  it("accepts an answer of 100 characters or more", () => {
    expect(AnserSchema.safeParse({ answer: "x".repeat(100) }).success).toBe(
      true,
    );
  });

  it("rejects an answer shorter than 100 characters", () => {
    expect(AnserSchema.safeParse({ answer: "x".repeat(99) }).success).toBe(
      false,
    );
  });
});

describe("ProfileSchema", () => {
  const valid = {
    name: "Arman Alam",
    username: "armanalam",
    bio: "Full-stack developer",
    portfolioWebsite: "https://example.com",
    location: "Pune, India",
  };

  it("accepts a valid profile", () => {
    expect(ProfileSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a name or username shorter than 5 characters", () => {
    expect(ProfileSchema.safeParse({ ...valid, name: "Al" }).success).toBe(
      false,
    );
    expect(ProfileSchema.safeParse({ ...valid, username: "ab" }).success).toBe(
      false,
    );
  });

  it("rejects a name or username longer than 50 characters", () => {
    expect(
      ProfileSchema.safeParse({ ...valid, name: "x".repeat(51) }).success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({ ...valid, username: "x".repeat(51) }).success,
    ).toBe(false);
  });

  it("rejects a bio shorter than 10 or longer than 150 characters", () => {
    expect(ProfileSchema.safeParse({ ...valid, bio: "short" }).success).toBe(
      false,
    );
    expect(
      ProfileSchema.safeParse({ ...valid, bio: "x".repeat(151) }).success,
    ).toBe(false);
  });

  it("rejects a non-URL portfolio website", () => {
    expect(
      ProfileSchema.safeParse({ ...valid, portfolioWebsite: "not-a-url" })
        .success,
    ).toBe(false);
  });

  it("rejects a location shorter than 5 characters", () => {
    expect(ProfileSchema.safeParse({ ...valid, location: "Goa" }).success).toBe(
      false,
    );
  });
});
