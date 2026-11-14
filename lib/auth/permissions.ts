/**
 * RBAC permission matrix (design §7.2) — the single source of truth
 * for who can do what. This file is isomorphic (no server-only
 * imports): server checks and client UI gating both call `can()`.
 * Never scatter ad-hoc `if (role === ...)` checks through components
 * or routes — add the action here instead.
 *
 * Roles form a hierarchy: admin > moderator > user. Each action names
 * the minimum role that may perform it.
 *
 * Source of truth for a user's role is Clerk `publicMetadata.role`,
 * mirrored into Mongo `User.role` by the webhook (see
 * app/api/webhook/route.ts). Server-side enforcement never trusts the
 * client: routes/actions resolve the role server-side in
 * lib/auth/server-permissions.ts.
 */
export type UserRole = "user" | "moderator" | "admin";

export const USER_ROLES: readonly UserRole[] = ["user", "moderator", "admin"];

/** Actions guarded by the matrix. `mcp:*` actions are forward-declared
 *  for P4 (MCP server) — nothing enforces them yet. */
export type AiPermissionAction =
  | "ai:draft:use"
  | "ai:duplicate:confirm"
  | "ai:admin:prompts"
  | "ai:admin:dashboard"
  | "mcp:key:create";

const ROLE_RANK: Record<UserRole, number> = {
  user: 1,
  moderator: 2,
  admin: 3,
};

/** Minimum role per action. */
const PERMISSION_MIN_ROLE: Record<AiPermissionAction, UserRole> = {
  // Any signed-in user may generate AI drafts (daily budget applies).
  "ai:draft:use": "user",
  // Moderators and admins review AI duplicate suggestions.
  "ai:duplicate:confirm": "moderator",
  // Prompt versions are admin-only (P1 registry; UI lands with RBAC).
  "ai:admin:prompts": "admin",
  // The /admin/ai usage dashboard is admin-only.
  "ai:admin:dashboard": "admin",
  // Any signed-in user may create an MCP read key (P4; forward-declared).
  "mcp:key:create": "user",
};

/** Parse an unknown value (Clerk metadata, Mongo field) into a role.
 *  Anything missing or invalid is a plain user — never an error. */
export function parseUserRole(value: unknown): UserRole {
  return parseUserRoleOrNull(value) ?? "user";
}

/** Same as parseUserRole, but returns null when no valid role is
 *  present — lets callers distinguish "explicitly a user" from
 *  "no role set anywhere" (e.g. prefer the Clerk claim, fall back to
 *  the Mongo field). */
export function parseUserRoleOrNull(value: unknown): UserRole | null {
  if (typeof value === "string" && (USER_ROLES as readonly string[]).includes(value)) {
    return value as UserRole;
  }
  return null;
}

/** Read the role out of a Clerk `publicMetadata` object. */
export function roleFromPublicMetadata(metadata: unknown): UserRole {
  if (metadata && typeof metadata === "object") {
    return parseUserRole((metadata as Record<string, unknown>).role);
  }
  return "user";
}

/** The one permission check. `role` may be undefined/null (a user
 *  created before roles existed) — that is a plain user. */
export function can(
  role: UserRole | undefined | null,
  action: AiPermissionAction
): boolean {
  return ROLE_RANK[role ?? "user"] >= ROLE_RANK[PERMISSION_MIN_ROLE[action]];
}

/** Minimum role for an action, for error messages. */
export function minRoleFor(action: AiPermissionAction): UserRole {
  return PERMISSION_MIN_ROLE[action];
}
