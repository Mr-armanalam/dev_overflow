/**
 * Shared helpers for the server-action tests (mock-based).
 *
 * Server actions talk to Mongoose models, Clerk (`@/lib/auth`) and
 * `next/cache`. These tests stub all three and assert the exact
 * queries/updates the action issues, the auth/ownership checks it
 * enforces, and the reputation deltas it applies — without a database.
 *
 * Conventions:
 * - Each test file declares its own `vi.hoisted` mocks (mock factories
 *   cannot reference imports) and imports `chainable` from here.
 * - `chainable(result)` stands in for a Mongoose Query: every chain
 *   method returns the query itself, `await query` resolves to
 *   `result`, and `.exec()` resolves to `result`.
 * - IDs are 24-hex strings so `isSameId` (String comparison) behaves
 *   exactly as it does with real ObjectIds.
 */
import { vi, type Mock } from "vitest";

/** A stand-in for a Mongoose Query: chainable and awaitable. */
export interface ChainableQuery<T> {
  populate: Mock;
  skip: Mock;
  limit: Mock;
  sort: Mock;
  exec: Mock;
  distinct: Mock;
  then(
    onfulfilled?: ((value: T) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown>;
}

export function chainable<T>(
  result: T,
  distinctResult?: unknown,
): ChainableQuery<T> {
  const query: ChainableQuery<T> = {
    populate: vi.fn(() => query),
    skip: vi.fn(() => query),
    limit: vi.fn(() => query),
    sort: vi.fn(() => query),
    exec: vi.fn(async () => result),
    distinct: vi.fn(async () => distinctResult ?? result),
    then: vi.fn(
      (
        resolve?: ((value: T) => unknown) | null,
        reject?: ((reason: unknown) => unknown) | null,
      ) => Promise.resolve(result).then(resolve, reject),
    ),
  };
  return query;
}

/** Fake Mongo user document as returned by `getAuthenticatedUser`. */
export function fakeUser(overrides?: {
  _id?: string;
  clerkId?: string;
  reputation?: number;
  saved?: string[];
}): {
  _id: string;
  clerkId: string;
  reputation: number;
  saved: string[];
} {
  return {
    _id: "507f1f77bcf86cd799439011",
    clerkId: "clerk_user_1",
    reputation: 0,
    saved: [],
    ...overrides,
  };
}

export const AUTHOR_ID = "507f1f77bcf86cd799439011";
export const OTHER_USER_ID = "507f1f77bcf86cd799439022";
export const QUESTION_ID = "507f1f77bcf86cd799439033";
export const ANSWER_ID = "507f1f77bcf86cd799439044";
export const TAG_ID = "507f1f77bcf86cd799439055";
