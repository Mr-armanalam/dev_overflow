# RAG setup — Atlas Vector Search (free M0 tier)

> **Correction (13 Nov 2026):** Atlas Vector Search runs on every tier
> including the free **M0** since 2024 (GA) — verified against MongoDB's
> official docs. The old design-doc claim that M10+ is required is
> wrong; only *dedicated search nodes* need M10+. **No tier upgrade is
> needed for P2.**
>
> M0 limits that shape this implementation: 512 MB storage, 100 ops/sec,
> shared compute, only a few search indexes per cluster, a subset of
> regions, auto-pause after 30 days idle. On M0/M2/M5 the vector index
> **must be created in the Atlas UI** — it cannot be created via API,
> and the app code never tries to.

## 1. Create the vector index (Atlas UI, once)

1. Atlas → your cluster → **Browse Collections** → `question_embeddings`
   (the collection is created automatically the first time the app writes
   a chunk; if it does not exist yet, ask one question / run the backfill
   first — the collection must exist before the index can be created).
2. Click the **Search Indexes** tab → **Create Search Index**.
3. Choose **JSON Editor** (not the visual builder).
4. Paste the contents of `docs/atlas-vector-index.json` — index name
   `question_embeddings_vector_index`, vector field `embedding`,
   768 dimensions, cosine similarity, plus `questionId` / `tags` as
   filter fields.
5. Click **Create Search Index**. Wait until its status is **Active**
   (a minute or two on M0). Until it is Active, retrieval returns no
   sources and drafts fall back to "No similar questions found" — the
   app does not crash.

## 2. Backfill existing questions (once, after the index is Active)

```bash
npm run backfill:embeddings
```

Runs `scripts/backfill-embeddings.ts` with `tsx`. It needs the same
server-only env vars as the app (`.env.local`: `MONGODB_URL`,
`GEMINI_API_KEY`). It embeds every question + its top ≤3 answers
(net score ≥ 0), ~250 ms apart to stay well under M0's 100 ops/sec,
prints a per-question progress line and a summary, and exits non-zero
if any question failed (re-run it — it deletes and re-embeds, so it is
safe to run twice). New questions/answers are indexed on write after
this, so the backfill is a one-off.

## 3. Smoke-test (preview deployment, real `GEMINI_API_KEY` set)

- Ask a question, then answer a similar one with **Generate AI Answer**:
  the draft panel shows a **Sources** list with links, and the draft
  cites them as `[1]`, `[2]`.
- Ask a question on a topic with no similar questions: the draft begins
  with "No similar questions found — answering from general knowledge".
- On **Ask a question**, type a title similar to an existing question:
  a "Similar questions" list appears live; a ≥0.8 match shows a
  "looks like a duplicate" suggestion. Nothing is ever auto-closed.
- `/admin/ai` shows the new `embedding` / `duplicate-detect` task rows.

## How it works (for reviewers)

- **Corpus:** question title + body + top ≤3 answers (net score ≥ 0).
  One chunk per question / answer, ~1,500 chars, split on Markdown
  headings when longer. Tag names ride inside the question chunk text.
- **Embeddings:** `gemini-embedding-2`, requested at 768 dimensions
  via `outputDimensionality` (Matryoshka truncation) to match the
  Atlas index, via the same `LlmProvider` path as the P1 draft calls
  (`lib/ai/client.ts`). (`text-embedding-004` was shut down by Google
  on Jan 14, 2026 — the backfill 404'd on it, hence this model.
  `gemini-embedding-001` was considered and rejected: it already
  carries a May 14, 2028 shutdown date, with `gemini-embedding-2`
  as Google's recommended replacement.)
- **Retrieval:** `$vectorSearch` top-12 by cosine → rerank
  `0.6·cosine + 0.25·(upvotes normalised) + 0.15·recency decay` → top-5.
- **Indexing:** fire-and-forget from `createQuestion` / `createAnswer` /
  `editQuestion` after a successful write; chunks are deleted on
  `deleteQuestion` / `deleteAnswer`. Indexing failures are logged to
  `AiUsageLog` (task `embedding`, status `error`) and never break the
  user's request.
- **Graceful degradation:** if the index does not exist yet, or the
  embedding call fails, retrieval returns no sources and the draft
  flow continues without citations.
