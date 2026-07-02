# Architecture

A deep-dive into how FeedForge is built and why.

---

## Overview

FeedForge is a monorepo with three main runtime targets:

| Target | Entry | Tech | Purpose |
|---|---|---|---|
| `feedforge-api` | `artifacts/cf-worker/src/index.ts` | Hono on CF Workers | All HTTP API endpoints |
| `feedforge-cron` | `artifacts/cf-worker/src/cron.ts` | Hono on CF Workers | Background jobs (cron) |
| Dashboard | `artifacts/bluesky-feeds/` | React + Vite | Web UI |

Shared libraries live in `lib/`:

| Library | Purpose |
|---|---|
| `lib/api-spec/openapi.yaml` | OpenAPI spec — source of truth for all API shapes |
| `lib/api-client-react/` | Auto-generated TanStack Query hooks (Orval) |
| `lib/api-zod/` | Auto-generated Zod schemas (Orval) |
| `lib/db/` | Shared Drizzle ORM config |

---

## Two-Worker Design

FeedForge splits into two Cloudflare Workers that share one D1 database:

### `feedforge-api` — HTTP Worker

- Handles all user-facing API requests
- No cron triggers — pure request/response
- No Smart Placement (every request handled at the nearest Cloudflare PoP to the user, which matters for global `getFeedSkeleton` latency)
- Uses Hono for routing and middleware

### `feedforge-cron` — Cron Worker

- Two cron triggers: `*/3 * * * *` (every 3 min) and `0 2 * * *` (daily at 2 AM UTC)
- Smart Placement enabled — anchors near D1's primary region since it does heavy write work
- Runs `runJetstreamIndexer()` each tick: opens a WebSocket to Bluesky Jetstream, collects events for 20 seconds, closes, writes matched posts to D1. Cursor persisted in `cron_settings` so each tick resumes exactly where the last stopped — no gaps.

> **Why not `JetstreamConsumerDO`?** A persistent Durable Object WebSocket sounds ideal, but Cloudflare bills incoming DO WebSocket messages at **20:1** against the DO free-tier quota (100K/day). At Bluesky's real firehose volume (~thousands of posts/min network-wide), the DO exhausts its quota in hours. The cron-based approach uses a plain Worker execution (not billed per-message) and is completely free. Trade-off: up to ~3 min indexing latency. `jetstream-do.ts` is kept in the repo for a future paid-tier migration.

**Why split?** Putting cron triggers and the Jetstream Durable Object in the same worker as the HTTP API created a conflict: Smart Placement (needed for D1-write-heavy cron work) anchors the entire worker to one region, which broke the latency of globally-distributed feed skeleton requests. Splitting lets each worker use the right placement strategy.

---

## Database Schema (D1/SQLite)

```
feeds               — feed definitions (name, description, avatar, active flag)
keywords            — keywords per feed used for post indexing
indexed_posts       — posts cached from Bluesky with engagement metrics
authors             — tracked authors with recalc scheduling
author_scores       — computed quality scores per author
feed_ranked_posts   — precomputed per-feed post rankings

cron_settings       — global key/value config and telemetry (last run times, drain state)
follower_snapshots  — daily snapshots of follower/following counts

scheduled_posts     — posts queued for future publishing
syndication_platforms — cross-platform posting config
syndication_log     — record of syndication attempts
amplification_queue — posts queued for engagement amplification

auto_unfollow_log       — history of completed unfollows
unfollow_scheduled_queue — DID-keyed queue of pending unfollows (unique per DID)
auto_follow_queue       — DID-keyed queue of pending follows
auto_follow_log         — follow tracking with follow-back status
```

### Key design decisions

**`unfollow_scheduled_queue` uses `ON CONFLICT DO UPDATE ... WHERE status = 'failed'`**
This means re-scanning only re-queues items that previously failed — it never resets `done` items back to `pending`. Without this, every scan cycle would undo completed unfollows by re-adding them to the queue.

**`cron_settings` is a key/value table, not a typed table**
This makes it easy to add new telemetry fields (last drain time, skip reason, etc.) without schema migrations. The downside is no type safety at the DB layer — all values are TEXT.

---

## Feed Indexing Pipeline

```
Bluesky Jetstream (firehose)
        │  (20s window per cron tick, cursor-based resume)
        ▼
runJetstreamIndexer()       — opens WebSocket, collects, closes (free tier safe)
        │ (new post events)
        ▼
Post filtering              — does post text match any active feed's keywords?
        │
        ▼
indexed_posts               — stored with algo_tags (which feeds matched)
        │
        ▼ (every 3-min cron tick)
Author scoring              — recalculate quality scores for dirty authors
        │
        ▼
feed_ranked_posts           — precompute final_score = quality × engagement
        │
        ▼
getFeedSkeleton             — served by feedforge-api via XRPC endpoint
```

### Author scoring

Each author gets a `score` based on their historical engagement (likes, reposts, replies). Authors are marked `needs_recalc = true` when their posts receive new engagement. The cron processes a batch of dirty authors each tick using a cooldown to avoid re-scoring the same author repeatedly.

### Engagement sync

`indexed_posts` engagement metrics (likes, reposts, replies, quotes) are refreshed periodically by the cron by calling `app.bsky.feed.getPosts` in batches. A `RANKING_COOLDOWN_HOURS` setting prevents re-ranking posts that were just ranked to reduce D1 write volume.

---

## Unfollow Campaign Flow

```
1. User clicks "Trigger Scan Now"
        │
        ▼
2. CF Worker: scan following list page by page (500/page via getFollows)
   — For each account: is follower_count < minFollowersToKeep?
   — Does the account follow back? (check followers list)
   — If not: INSERT into unfollow_scheduled_queue (skip if already done)
        │
        ▼
3. Every 3-min cron tick: runScheduledUnfollow()
   — SELECT up to 100 pending rows
   — For each: call agent.deleteFollow(followUri)
   — 150ms delay between each to stay safe within rate limits
   — Mark done or failed
   — Auto-retry failed rows after 15 min
        │
        ▼
4. Dashboard polls /api/bluesky/unfollow-campaign/status every 4s
   — Shows live: pending / done / failed / estimated time remaining
   — Shows lastDrain telemetry: when cron last ran, how many it processed
```

**Rate math:** 100 unfollows × 150ms delay = 15s overhead + ~30s network ≈ fits in 3 min. Effective rate ≈ 2,000 unfollows/hr. Bluesky's limit is 600/min — we operate at ~33/min. Very safe margin.

---

## API Design

All API shapes are defined in `lib/api-spec/openapi.yaml`. The codegen workflow (Orval) generates:
- TanStack Query hooks in `lib/api-client-react/src/generated/`
- Zod schemas in `lib/api-zod/src/generated/`

**Never edit generated files.** Always edit `openapi.yaml` then run:
```bash
pnpm --filter @workspace/api-spec run codegen
```

The frontend never calls `fetch()` directly. It uses either:
- Generated hooks: `useListFeeds()`, `useGetProfile()`, etc.
- `customFetch()` for mutations and one-off calls not covered by the spec

`customFetch()` reads `VITE_API_BASE_URL` and in development proxies through Vite to avoid CORS issues.

---

## D1 Write Optimization

Cloudflare D1's free tier allows 100,000 writes/day. FeedForge is optimized to use approximately 65,000 writes/day with typical usage:

| Optimization | Reduction |
|---|---|
| Author ranking cooldown (`RANKING_COOLDOWN_HOURS`) | Prevents re-ranking posts that were just ranked |
| Batch `markAuthorDirty` | One D1 batch per cron tick instead of one write per post |
| Cron heartbeat consolidation | Telemetry written once per tick, not per-operation |
| Skip reason written on early return | One write instead of multiple when no work to do |

If you're approaching the write limit, reduce the number of indexed keywords or increase `RANKING_COOLDOWN_HOURS` in cron settings.

---

## Local Development vs Production

| Concern | Dev | Production |
|---|---|---|
| API | Express stub (`api-server`) or CF Worker via Vite proxy | CF Worker or Express on VPS |
| Database | D1 local (wrangler dev) or PostgreSQL | D1 remote or PostgreSQL |
| Cron | Manual trigger via `/api/admin/cron-tick` | CF cron triggers or system cron |
| Auth | Credentials in `.env.local` | Secrets via `wrangler secret put` |
| Frontend | Vite dev server with HMR | Static build on CF Pages or nginx |
