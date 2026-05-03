# FeedForge — Bluesky Custom Feed Generator

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: Vite + React + Tailwind CSS + shadcn/ui

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Architecture

### Artifacts

- `artifacts/api-server` — Express API server with Drizzle ORM + PostgreSQL
- `artifacts/bluesky-feeds` — Vite React frontend (the main UI)
- `artifacts/cf-worker` — Cloudflare Worker for production (D1 database)

### Key Libraries

- `lib/api-spec/openapi.yaml` — Single source of truth for all API contracts
- `lib/api-client-react` — Generated React Query hooks from OpenAPI
- `lib/api-zod` — Generated Zod schemas from OpenAPI
- `lib/db` — Drizzle ORM schema + PostgreSQL client

## API Routes

### Feeds

- `GET /api/feeds` — list all feeds
- `POST /api/feeds` — create feed
- `GET/PATCH/DELETE /api/feeds/:id` — manage feed
- `GET/POST/DELETE /api/feeds/:id/keywords` — manage keywords
- `GET /api/feeds/:id/posts` — indexed posts for feed
- `POST /api/feeds/:id/publish` — publish feed to Bluesky

### Analytics

- `GET /api/stats/overview` — total stats
- `GET /api/stats/recent-activity` — 24h hourly buckets
- `GET /api/stats/7day` — 7-day daily buckets
- `GET /api/stats/top-feeds` — feeds ranked by post count
- `GET /api/feeds/:id/keyword-stats` — keyword performance
- `GET /api/feeds/:id/top-authors` — top contributing authors
- `GET /api/feeds/:id/hourly` — hourly activity for a feed

### Bluesky Integration

- `GET /api/bluesky/profile` — authenticated user's Bluesky profile
- `GET /api/bluesky/my-posts` — user's own posts with engagement stats (likes, reposts, replies, quotes)
- `GET /api/bluesky/feed-info/:recordName` — published feed info from Bluesky
- `POST /api/bluesky/sync-engagement` — sync engagement counts for indexed posts
- `GET /api/bluesky/followers` — follower list
- `GET /api/bluesky/following` — following list
- `GET /api/bluesky/not-following-back` — accounts not following back
- `POST /api/bluesky/bulk-follow` / `bulk-unfollow`
- `POST /api/bluesky/compose` — publish a post or thread to Bluesky
- `GET /api/bluesky/best-time` — analyse hourly engagement to find best posting hours
- `GET /api/bluesky/follower-growth` — retrieve stored follower snapshots
- `POST /api/bluesky/snapshot-followers` — record current follower count snapshot

### Scheduled Posts

- `GET /api/scheduled-posts` — list scheduled posts
- `POST /api/scheduled-posts` — create a scheduled post
- `DELETE /api/scheduled-posts/:id` — cancel a scheduled post
- Background scheduler runs every 60 s via `startScheduler()` in `index.ts`

### XRPC (Feed Generator Protocol)

- `GET /xrpc/app.bsky.feed.getFeedSkeleton` — serves feed skeleton to Bluesky clients
- `GET /xrpc/app.bsky.feed.describeFeedGenerator` — describes available feeds
- `GET /.well-known/did.json` — DID document for feed generator

## Frontend Pages

- **Dashboard** — overview stats, firehose status, profile summary
- **Feeds** — list, create, manage feeds
- **FeedDetail** — per-feed tabs: Posts, Test Live, Analytics, Keywords
  - "Test Live" tab calls `getFeedSkeleton` then resolves posts via Bluesky public API
- **Compose** (`/compose`) — three tabs:
  - _Post Now_ — single post composer with char counter, ⌘+Enter shortcut, success link
  - _Thread Builder_ — multi-part composer (up to 10 parts), each with individual char counter
  - _Scheduled_ — create/cancel scheduled posts; lists pending/sent/failed
- **Analytics** — four tabs:
  - _My Posts_ — X-style post analytics with engagement overview + Export CSV button
  - _Feed Posts_ — feed post browser
  - _Feed Stats_ — per-feed indexing analytics
  - _Best Time_ — bar chart of avg engagement by hour (UTC), best hour/day cards, top 5 hours list
- **Audience** — six tabs: followers, following, not-following-back, top authors, growth, search
  - _Growth_ tab — follower line chart over time, delta since first snapshot, snapshot history, "Record Snapshot" button
- **Posts** — browse all indexed posts
- **Settings** — environment variable status

## Design System

- Zinc/editorial palette, near-black sidebar, cobalt blue primary (`hsl(210 100% 52%)`)
- Mobile-responsive with Sheet drawer + bottom nav
- All pages: `px-4 py-5 md:px-8 md:py-8`

## Publisher Config

- DID: `did:plc:oobxeg4vljlqpp62k7fd6flp` (bruceoyugi.bsky.social)
- CF Worker: `feedforge-api.manmysterious2020.workers.dev`
- Vercel frontend: `https://bluesky-feed-master-api-server.vercel.app/`
