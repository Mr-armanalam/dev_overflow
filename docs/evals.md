# Evals — answer-draft quality gate (design §9.2)

`scripts/eval-ai.ts` runs the current answer-draft pipeline against
the golden set in `evals/golden.json` and scores it. **No prompt or
model change merges without this script passing.**

## Running it

```bash
# Needs .env.local with MONGODB_URL (Atlas cluster with the vector
# index + embeddings from the P2 backfill) and GEMINI_API_KEY.
npm run eval:ai

# Options:
npm run eval:ai -- --limit 5        # first 5 pairs (smoke test)
npm run eval:ai -- --id eval-01     # one pair
npm run eval:ai -- --out evals/last-run.json   # write a JSON report
```

Without the env vars the script exits 2 with a plain-English error
(it does not crash with a stack trace). It cannot run in a sandbox
with no database or key — run it on a machine with `.env.local`.

## What it scores (per pair, then averaged)

| Metric | How | Threshold |
| --- | --- | --- |
| Faithfulness | Judge model (same Gemini flash, via `lib/ai`): are the answer's claims supported by the retrieved sources, or correctly marked as general knowledge? Does it cover the pair's `expectedPoints`? | mean ≥ **0.8** |
| Citation precision | `[n]` markers that reference a retrieved source *and* whose excerpt the judge found relevant, over all `[n]` markers. No markers scores 1 when nothing was retrieved, 0 when sources were retrieved but never cited. | mean ≥ **0.7** |
| Code syntax | Fenced ts/tsx/js/jsx code blocks are syntax-checked per snippet (`ts.transpileModule`). Reported, but not a merge gate on its own — a failing pair is listed and must be investigated. | listed |
| Latency + cost | Measured locally per pair; cost from `lib/ai/pricing.ts` (approximate). Eval runs are **not** written to `AiUsageLog` — they are offline runs, not user calls. | informational |

Exit code: 0 = passed, 1 = a threshold failed (failed pairs are
listed), 2 = the run could not start (missing env vars / bad args).

## The golden set (`evals/golden.json`)

30 hand-checked pairs in this app's domain (React, Next.js,
TypeScript, Mongoose/MongoDB, Clerk, Tailwind, Zod, Node). Each entry:

```json
{
  "id": "eval-01",
  "question": "...",
  "expectedPoints": ["verifiable fact the answer must contain", "..."]
}
```

Rules for adding a pair:

- `expectedPoints` must be **verifiable facts** — never invent a
  library API in an expected answer.
- Keep questions in the app's domain (the stack it uses, and the
  questions its users actually ask).
- One pair per concept; prefer questions where a wrong answer is
  easy to spot.

## Feedback loop — thumbs-down becomes a golden entry

1. Users rate AI drafts with the feedback thumbs in the answer form;
   ratings land in `AiUsageLog.feedback` (`helpful` / `not_helpful`).
2. **Weekly (manual):** an admin opens `/admin/ai`, finds the
   lowest-rated outputs (filter `feedback = not_helpful`, sort by
   recency), and reads the 10 worst.
3. For each one, decide: is it a **prompt problem** (wrong
   instruction → fix the prompt, new version file), a **retrieval
   problem** (wrong/missing sources → check embeddings + index), or a
   **genuinely new question type** (add a golden pair covering it)?
4. New golden entries are added by hand in `evals/golden.json` —
   **never auto-added** from user data. A thumbs-down is a candidate,
   not an entry: the reviewer writes the `expectedPoints` themselves.
5. Re-run `npm run eval:ai` after any prompt/model change and before
   merging. If the thresholds fail, the change does not merge — tune
   the prompt (new version file) or the retrieval, then re-run.

## Known limitations

- **Self-judging bias:** the judge is the same flash model that
  wrote the draft. A stronger judge (e.g. gemini-2.5-pro) is future
  work (P5); for now, treat a borderline pass (0.80–0.85) as "review
  the failed pairs by hand" rather than a clean bill of health.
- **Syntax-only code check:** a block can parse and still be wrong
  (wrong API, wrong logic). It catches malformed code, not
  hallucinated APIs — that is the judge's job.
- **Corpus-dependent:** scores depend on what is actually in the
  database. On an empty or unindexed database, retrieval returns
  nothing and the draft must say "No similar questions found" —
  faithfulness then measures the general-knowledge answer only.
  Run the P2 backfill (`npm run backfill:embeddings`) before
  treating a baseline as meaningful.
