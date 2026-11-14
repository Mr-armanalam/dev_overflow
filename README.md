# Dev Overflow

Dev Overflow is a developer Q&A platform: ask questions, write answers, vote on answers, browse by tag, and save questions to collections. It also includes an AI-assisted answering workflow — streaming answer drafts grounded in similar questions via retrieval, tag suggestions, duplicate detection, and an MCP server — with per-user budgets, caching, and usage dashboards.

## Features

### Q&A

- Ask questions with a TinyMCE rich-text editor and comma-separated tag input
- Answer questions, vote answers up and down, and save questions to collections
- Reputation that moves with votes on your answers, and activity badges (Gold, Silver, Bronze), including a TOTAL_VIEWS badge
- User profiles with top posts, answers, and stats, plus a community directory
- Global search across questions, answers, users, and tags, plus per-page local search, with search state kept in the URL

### AI-assisted answering

- Streaming answer drafts (Gemini 2.5 Flash) with citations to similar questions retrieved from MongoDB Atlas Vector Search (gemini-embedding-2, 768 dimensions)
- Drafts are never published automatically: the user reviews the draft, inserts it into the editor, edits, and submits. AI-assisted answers are badged and earn no reputation
- Tag suggestions for a question draft
- Live similar-question suggestions while asking, with duplicate detection (suggestion only, never auto-close); moderators review duplicates in `/admin/duplicates`
- Daily budgets: 10 answer drafts and 20 tag suggestions per user per day; cache hits do not consume budget
- Exact and semantic caching plus per-IP burst limits via Upstash Redis (optional — the app works without it)
- MCP server (`POST /api/mcp`, Streamable HTTP) with API keys: search questions, get a question, list tags, get public user stats, create answer drafts (draft-only, no publishing)
- Role-based access (user, moderator, admin) with a usage dashboard at `/admin/ai`
- Quality gate: `scripts/eval-ai.ts` scores drafts against a 30-pair golden set (`evals/golden.json`) for faithfulness (mean >= 0.8) and citation precision (mean >= 0.7)
- Kill switch: `AI_ENABLED=false` disables all `/api/ai/*` endpoints (they return 503)

## Tech stack

| Area | Technology |
| --- | --- |
| Framework | Next.js 16.4.6 (App Router, React 19.3.1) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4.3.5 (CSS-first theme in `app/globals.css`), shadcn/ui + Radix UI |
| Database | MongoDB Atlas via Mongoose 9.12.1 |
| Auth | Clerk 7.9.26 (authentication, webhooks) |
| Validation | Zod 4.6.7 |
| Editor | TinyMCE 8.10.2 (`@tinymce/tinymce-react` 6.3.1) |
| AI | Vercel AI SDK 5.0.289, `@google/genai` 2.32.0; Gemini 2.5 Flash, gemini-embedding-2 |
| MCP | `@modelcontextprotocol/sdk` 1.32.2 |
| Cache / rate limit | Upstash Redis 1.41.0, `@upstash/ratelimit` 2.2.1 |
| Testing | Vitest 4 |
| Linting | ESLint 9 (flat config) |

## Getting started

### Prerequisites

- Node.js 24 (see `.nvmrc`) and npm
- A MongoDB Atlas cluster (M0 free tier works, including Atlas Vector Search)
- A Clerk application (sign-up/sign-in + webhook)
- A Google AI Studio API key for Gemini

### Setup

```bash
git clone https://github.com/Mr-armanalam/dev_overflow.git
cd dev-overflow
npm ci
cp .env.example .env.local
```

Fill in `.env.local` (all values are server-only except the two `NEXT_PUBLIC_*` keys, which are public by design):

| Variable | Required | Notes |
| --- | --- | --- |
| `MONGODB_URL` | Yes | Atlas connection string |
| `GEMINI_API_KEY` | Yes | Google AI Studio key |
| `WEBHOOK_SECRET` | Yes | Clerk webhook signing secret |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key |
| `NEXT_PUBLIC_tINY_EDITOR_API_KEY` | Yes | TinyMCE cloud API key |
| `AI_ENABLED` | No | Set to `false` to disable all AI endpoints (default: enabled) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Enable AI caching and burst limits; the app works without them |

Never commit real values, and never put a secret in a `NEXT_PUBLIC_*` variable — those values are inlined into the client bundle.

```bash
npm run dev     # http://localhost:3000
```

```bash
npm run build
npm run start
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (`vitest run`) |
| `npm run backfill:embeddings` | Embed existing questions/answers into `question_embeddings` (one-off, see `docs/rag-setup.md`) |
| `npm run eval:ai` | Score answer drafts against the golden set (see `docs/evals.md`) |

## Project structure

```text
app/                  Next.js App Router — (root) route group, API routes, layouts
  (root)/             Home, ask-question, question/[id], tags, community, profile, collection, admin
  api/                Route handlers: ai/draft, ai/similar, ai/tags, mcp, webhook, chatgpt
components/           React components — forms, cards, shared layout, admin, shadcn/ui primitives
context/              Theme provider
lib/                  Server actions, Mongoose connection, validation, auth helpers
  ai/                 AI layer: provider + router, prompts, RAG, guardrails, cache, budgets, MCP
database/             Mongoose models (User, Question, Answer, Tag, Interaction, AiUsageLog, ...)
docs/                 Setup guides: RAG (Atlas Vector Search), Upstash, evals
scripts/              Backfill + eval CLIs (run with tsx)
evals/                Golden set for answer-draft evals
public/               Static assets (icons, Open Graph images)
```

## AI setup

The AI features work once `MONGODB_URL` and `GEMINI_API_KEY` are set; Upstash is optional. Details live in the docs:

- [docs/rag-setup.md](docs/rag-setup.md) — create the Atlas vector index, run the backfill, smoke-test RAG citations
- [docs/upstash-setup.md](docs/upstash-setup.md) — create a free Upstash Redis database for the AI cache and rate limits
- [docs/evals.md](docs/evals.md) — run and extend the answer-draft quality gate
