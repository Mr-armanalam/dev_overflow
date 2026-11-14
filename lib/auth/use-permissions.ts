/**
 * Client-side UI gating (design §7.2). This only decides what to
 * SHOW — the Clerk `publicMetadata.role` in the session is readable
 * client-side by design. Authorization is always enforced server-side
 * in lib/auth/server-permissions.ts; hiding a link here never grants
 * or denies access on its own.
 */
"use client";

import { useUser } from "@clerk/nextjs";
import { can, parseUserRole, type AiPermissionAction } from "./permissions";

export function useCan(action: AiPermissionAction): boolean {
  const { user } = useUser();
  return can(parseUserRole(user?.publicMetadata?.role), action);
}
