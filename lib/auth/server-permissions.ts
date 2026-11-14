/**
 * Server-side role resolution + enforcement (design §7.2).
 *
 * Every protected route/action calls `requirePermission(action)` and
 * every protected admin page calls `requirePermissionForPage(action)`.
 * The role is resolved server-side only: Clerk session claims first
 * (the JWT carries `publicMetadata.role`), Mongo `User.role` as the
 * fallback — the webhook keeps it in sync. The client is never
 * trusted for authorization; UI gating in `lib/auth/use-permissions`
 * only decides what to show.
 */
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/mongoose";
import User, { type IUser } from "@/database/user.model";
import {
  can,
  minRoleFor,
  parseUserRole,
  parseUserRoleOrNull,
  type AiPermissionAction,
  type UserRole,
} from "./permissions";

export interface ActingUser {
  clerkId: string;
  role: UserRole;
  /** Null when the Clerk user has not been synced to Mongo yet. */
  mongoUser: IUser | null;
}

/**
 * Resolve the acting user from the Clerk session. Returns null when
 * nobody is signed in. Never throws for a signed-in user — a missing
 * Mongo row just means role "user" until the webhook syncs.
 */
export async function resolveActingUser(): Promise<ActingUser | null> {
  const { userId: clerkId, sessionClaims } = await auth();
  if (!clerkId) {
    return null;
  }

  const claimRole = parseUserRoleOrNull(
    (sessionClaims as { publicMetadata?: Record<string, unknown> } | null)
      ?.publicMetadata?.role
  );

  await connectToDatabase();
  const mongoUser = await User.findOne({ clerkId });

  return {
    clerkId,
    role: claimRole ?? parseUserRole(mongoUser?.role),
    mongoUser,
  };
}

/**
 * For API routes and server actions: returns the acting user or throws.
 * Callers map the thrown error to 401/403 — the message starts with
 * "Unauthorized:" / "Forbidden:" so the mapping is mechanical.
 */
export async function requirePermission(
  action: AiPermissionAction
): Promise<ActingUser> {
  const acting = await resolveActingUser();
  if (!acting) {
    throw new Error("Unauthorized: please sign in");
  }
  if (!can(acting.role, action)) {
    throw new Error(
      `Forbidden: ${action} requires the ${minRoleFor(action)} role`
    );
  }
  return acting;
}

/**
 * For server-component admin pages: not signed in → sign-in page;
 * signed in without the role → 404, so the page stays hidden instead
 * of advertising that it exists.
 */
export async function requirePermissionForPage(
  action: AiPermissionAction
): Promise<ActingUser> {
  const acting = await resolveActingUser();
  if (!acting) {
    redirect("/sign-in");
  }
  if (!can(acting.role, action)) {
    notFound();
  }
  return acting;
}
