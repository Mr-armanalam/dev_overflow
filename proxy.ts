import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Public routes — everything else requires a signed-in user
// (auth.protect() below redirects signed-out visitors to sign-in).
//
// NOTE (Clerk 7 / Core 3): `createRouteMatcher` gating in middleware is
// DEPRECATED in v7 (removed in the next major) — Clerk now recommends
// resource-based checks (`await auth.protect()` at the top of each page,
// route handler and server action). It still works in v7, so this file
// keeps the exact protection behaviour of v6 while the codebase moves
// to v7. The resource-based migration is a separate follow-up; until
// then, do NOT remove this gate — it is the only thing protecting
// pages that do not call auth.protect() themselves.
//
// The P4 base this branch stacks on still carried the pre-P1 typos
// ('question/:id', '/profile:id') and the dead '/jobs' entry (no /jobs
// page exists; P1 removed the link). This rewrite uses the correct
// patterns, so those are gone as a consequence — not as a separate fix.
const isPublicRoute = createRouteMatcher([
  '/sign-up(.*)',
  '/sign-in(.*)',
  '/',
  '/api/webhook',
  '/question/:id',
  '/tags',
  '/tags/:id',
  '/profile/:id',
  '/community',
  // MCP clients authenticate with Bearer <redacted> keys, never Clerk
  // cookies — the route enforces its own auth (lib/ai/mcp/auth.ts),
  // so Clerk middleware must not redirect them to sign-in.
  '/api/mcp',
])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})


export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
