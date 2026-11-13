# Upstash Redis setup (P3 — cache + rate limiting)

The AI cache (exact + semantic) and the per-IP burst limit on `/api/ai/*`
run on Upstash Redis. Upstash is serverless Redis over HTTPS — no TCP
connection, no pool, which is why it works from Vercel serverless
functions. The code uses the `@upstash/redis` client and the
`@upstash/ratelimit` package (already in `package.json`).

## 1. Create the free-tier database (Arman's step, ~5 minutes)

1. Go to https://console.upstash.com and sign up / sign in (GitHub
   sign-in works; no credit card is needed for the free tier).
2. Open the **Redis** tab and click **Create Database**.
3. Name: anything descriptive, e.g. `dev-overflow-ai-cache`.
4. Region: pick the region closest to the Vercel deployment
   (e.g. `ap-south-1` / Mumbai if the Vercel project is in Asia;
   any region works, the closest one is just faster).
5. Type: **Regional** (default). Plan: **Free**.
6. Click **Create**.

Free tier (current limits — check the console if they change):
500K commands/month, ~256 MB storage, 1 database. A cache hit is
1 command; a rate-limit check is 2–3. A free database is archived
after 30 days of inactivity, so open the console once a month or
keep the app in use.

## 2. Copy the two values

On the database **Details** tab, under **REST API**, copy:

| Value | Where it goes |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | The REST endpoint, e.g. `https://<name>-<id>.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | The REST token (long `AX…` string) |

Never commit these. They are secrets — same handling as
`MONGODB_URL` / `GEMINI_API_KEY`.

## 3. Set them in Vercel

Vercel Dashboard → project → **Settings → Environment Variables**:

- `UPSTASH_REDIS_REST_URL` = the URL from step 2
- `UPSTASH_REDIS_REST_TOKEN` = the token from step 2

Set them for **Production** (and Preview, if you want the preview
deployments to cache too), then **redeploy** — env vars only apply
to new deployments.

For local development, add the same two lines to `.env.local`
(not committed).

## 4. What happens until the vars are set

Nothing breaks. The code degrades gracefully when either var is
absent (see `lib/ai/cache.ts` / `lib/ai/ratelimit.ts`):

- Cache lookups return a miss; every draft call goes to the provider.
- The burst limit is skipped (no 429s).
- `AiUsageLog` rows are written with `cacheHit: false`.
- The kill switch (`AI_ENABLED=false`) and degraded mode still work.

So the app is fully usable with no Upstash account at all — the
cache and rate limit simply stay off until you set the vars and
redeploy.

## 5. Verify it works (smoke test, after the preview deploy)

1. Ask for an AI draft on a question, then ask again on the same
   question → the second draft should show **"Served from cache —
   no AI call used."** in the AI panel (and `x-ai-cache: exact` in
   the `/api/ai/draft` response headers).
2. Ask for a draft on a near-identical new question (same wording,
   tiny change) → **"From a similar question"** with a link to the
   original.
3. Burst: send ~25 draft/tag requests in under a minute from one IP
   → the 21st+ returns `429` with `error: "Rate limit exceeded"`
   and a `Retry-After` header. The `/api/ai/similar` route allows
   60/min (it fires while typing).
4. `AI_ENABLED=false` → the draft endpoint serves similar questions
   with `"try again later"` instead of a bare error.
5. `/admin/ai` → the Usage table shows the `cacheHit` column and
   429 rows with status `rejected` / error code `RATE_LIMITED`.

## What is cached, and for how long

| Cache | Key | TTL |
| --- | --- | --- |
| Draft (exact) | SHA-256 of `answer-draft` v1 + normalised question | 24 h |
| Tags (exact) | SHA-256 of `tag-suggest` v1 + normalised title/body | 24 h |
| Duplicate verdict (exact) | SHA-256 of `duplicate-detect` v1 + title/body + candidate ids | 24 h |
| Draft (semantic) | question id, looked up when a new question is ≥ 0.95 cosine-similar to a cached one | 24 h |
| Summaries | reserved — no summarise-thread task exists yet | 7 days (when built) |

Cache hits never consume the daily AI budget (10 drafts /
20 tag-suggest per user per day).

## If you ever need to clear it

Upstash Console → database → **Data Browser** → delete the keys
starting `ai:cache:` (exact cache) or `ai:semantic:` (semantic
cache), or flush the whole database. The app keeps working —
everything is re-derived from the provider on the next call.
