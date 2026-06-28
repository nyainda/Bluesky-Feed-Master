# FeedForge — Bluesky Feed Master

## Overview

Production-focused pnpm monorepo for building, ranking, and serving custom Bluesky feeds.

This project includes:
- Post ingestion + indexing
- Async author scoring pipeline
- Smart quality scoring layer
- Precomputed ranked feed tables for fast API responses
- Dashboard + creator tooling (analytics, audience, compose, notifications)

## Current Version

- **v1.2.0**

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 22+
- **TypeScript**: 5.9
- **API server**: Express 5
- **Worker runtime**: Cloudflare Workers + Hono
- **Databases**:
  - PostgreSQL + Drizzle ORM (API server path)
  - Cloudflare D1 + Drizzle ORM (Worker path)
- **Frontend**: React + Vite + Tailwind + shadcn/ui

## Architecture (What we implemented)

### 1) Ingestion layer
- Collects/updates posts into `indexed_posts`
- Marks touched authors as dirty for async score recompute

### 2) Author scoring layer (async)
- `authors` + `author_scores` tables
- Batched worker recompute with retry/cooldown controls
- Scores derived from post count + engagement aggregates

### 3) Smart quality layer
- Post quality scoring utilities (engagement velocity, reply-depth proxy, recency)

### 4) Ranking precompute layer
- Computes weighted final scores per feed
- Writes rankings into `feed_ranked_posts`
- Clears stale rows per feed before writing new snapshot

### 5) Serving layer
- `/api/feeds/:id/posts?mode=ranked` serves precomputed ranked rows
- Fallback to recent chronological posts if ranked cache is empty

## Key Worker Migrations

- `0001_init.sql`
- `0002_follower_snapshots.sql`
- `0003_author_scoring.sql`
- `0004_feed_ranked_posts.sql`

## Key Commands

### Workspace
- `pnpm run typecheck`
- `pnpm run build`

### Scripts / validation
- `pnpm --filter @workspace/scripts run test:author-scoring`
- `pnpm --filter @workspace/scripts run verify:release`

### Cloudflare Worker
- `pnpm --filter @workspace/cf-worker run db:migrate:all`
- `pnpm --filter @workspace/cf-worker run db:migrate:remote:all`
- `pnpm --filter @workspace/cf-worker run deploy`

## Deploy Notes

If Cloudflare deploy logs show old code signatures:
1. Confirm deployment commit SHA matches latest branch SHA.
2. Run `verify:release` before deploy.
3. Re-run remote migrations and deploy from `artifacts/cf-worker`.

## API Highlights

### Feed endpoints
- `GET /api/feeds`
- `POST /api/feeds`
- `GET /api/feeds/:id/posts?mode=recent|ranked`

### Analytics / audience
- Stats, follower insights, top authors, growth snapshots

### Compose
- Publish now, thread builder, scheduled posts
