/**
 * Tests for lib/auth/server-permissions.ts: `resolveActingUser` role
 * resolution and the `requirePermissionForPage` gate. Clerk's `auth()` /
 * `currentUser()`, the User model and the DB connect are mocked; no
 * database or network is touched.
 *
 * The case this pins: a signed-in admin whose session token predates
 * the role change (the JWT claims carry no role) and whose Mongo row
 * is stale (the Clerk webhook never delivers on localhost) must still
 * resolve as admin — the Clerk Backend API breaks the tie. Before the
 * fix, that request 404'd on /admin/ai while a request with a fresh
 * token returned 200 for the same user.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clerkAuth: vi.fn(),
  clerkCurrentUser: vi.fn(),
  userFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.clerkAuth,
  currentUser: mocks.clerkCurrentUser,
}));
vi.mock("@/database/user.model", () => ({
  default: { findOne: mocks.userFindOne, updateOne: mocks.userUpdateOne },
}));
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: mocks.connect }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

import {
  requirePermissionForPage,
  resolveActingUser,
} from "./server-permissions";

const CLERK_ID = "user_2oQTjJjLgXlwL1oP03ahRKkUPNe";

function signedInAs(roleInClaims: string | undefined) {
  mocks.clerkAuth.mockResolvedValue({
    userId: CLERK_ID,
    sessionClaims: {
      publicMetadata: roleInClaims ? { role: roleInClaims } : {},
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.userFindOne.mockResolvedValue(null);
  mocks.userUpdateOne.mockResolvedValue({ acknowledged: true });
  mocks.clerkCurrentUser.mockResolvedValue(null);
});

describe("resolveActingUser", () => {
  it("returns null when nobody is signed in", async () => {
    mocks.clerkAuth.mockResolvedValue({ userId: null, sessionClaims: null });

    await expect(resolveActingUser()).resolves.toBeNull();
    expect(mocks.clerkCurrentUser).not.toHaveBeenCalled();
  });

  it("uses the claims role when present and never calls Clerk", async () => {
    signedInAs("admin");
    mocks.userFindOne.mockResolvedValue({ clerkId: CLERK_ID, role: "user" });

    const acting = await resolveActingUser();

    expect(acting?.role).toBe("admin");
    expect(mocks.clerkCurrentUser).not.toHaveBeenCalled();
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
  });

  it("resolves admin from the Clerk API when the claims are silent and the Mongo row is stale", async () => {
    signedInAs(undefined);
    mocks.userFindOne.mockResolvedValue({ clerkId: CLERK_ID, role: "user" });
    mocks.clerkCurrentUser.mockResolvedValue({
      publicMetadata: { role: "admin" },
    });

    const acting = await resolveActingUser();

    expect(acting?.role).toBe("admin");
    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { clerkId: CLERK_ID },
      { role: "admin" }
    );
  });

  it("does not heal the mirror when it already agrees with Clerk", async () => {
    signedInAs(undefined);
    mocks.userFindOne.mockResolvedValue({ clerkId: CLERK_ID, role: "admin" });
    mocks.clerkCurrentUser.mockResolvedValue({
      publicMetadata: { role: "admin" },
    });

    const acting = await resolveActingUser();

    expect(acting?.role).toBe("admin");
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
  });

  it("keeps role user when Clerk agrees the user is not an admin", async () => {
    signedInAs(undefined);
    mocks.userFindOne.mockResolvedValue({ clerkId: CLERK_ID, role: "user" });
    mocks.clerkCurrentUser.mockResolvedValue({
      publicMetadata: { role: "user" },
    });

    const acting = await resolveActingUser();

    expect(acting?.role).toBe("user");
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
  });

  it("falls back to the Mongo role when Clerk is unreachable", async () => {
    signedInAs(undefined);
    mocks.userFindOne.mockResolvedValue({
      clerkId: CLERK_ID,
      role: "moderator",
    });
    mocks.clerkCurrentUser.mockRejectedValue(new Error("Clerk is down"));

    const acting = await resolveActingUser();

    expect(acting?.role).toBe("moderator");
  });

  it("resolves admin from Clerk when there is no Mongo row yet", async () => {
    signedInAs(undefined);
    mocks.userFindOne.mockResolvedValue(null);
    mocks.clerkCurrentUser.mockResolvedValue({
      publicMetadata: { role: "admin" },
    });

    const acting = await resolveActingUser();

    expect(acting?.role).toBe("admin");
    expect(acting?.mongoUser).toBeNull();
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
  });
});

describe("requirePermissionForPage", () => {
  it("redirects when nobody is signed in", async () => {
    mocks.clerkAuth.mockResolvedValue({ userId: null, sessionClaims: null });

    await expect(
      requirePermissionForPage("ai:admin:dashboard")
    ).rejects.toThrow("NEXT_REDIRECT");
  });

  it("404s for a signed-in user without the admin role", async () => {
    signedInAs("user");
    mocks.userFindOne.mockResolvedValue({ clerkId: CLERK_ID, role: "user" });

    await expect(
      requirePermissionForPage("ai:admin:dashboard")
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.clerkCurrentUser).not.toHaveBeenCalled();
  });

  it("lets an admin through when the claims are silent but Clerk says admin", async () => {
    signedInAs(undefined);
    mocks.userFindOne.mockResolvedValue({ clerkId: CLERK_ID, role: "user" });
    mocks.clerkCurrentUser.mockResolvedValue({
      publicMetadata: { role: "admin" },
    });

    const acting = await requirePermissionForPage("ai:admin:dashboard");

    expect(acting.role).toBe("admin");
  });
});
