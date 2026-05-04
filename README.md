# FeedForge (Bluesky Feed Master)

FeedForge is a production-focused Bluesky feed platform built as a pnpm monorepo.

It combines:
- **Data ingestion** from Bluesky streams/search
- **Author scoring** with async recalculation
- **Quality filtering** for better signal vs noise
- **Precomputed ranking** for fast feed responses
- **Creator tools** (analytics, audience, compose/schedule, notifications)

## What this project does

### 1) Ingest and index social content
The worker/API layer ingests posts and stores normalized records in the database.

### 2) Compute author reputation signals
A background scoring pipeline recalculates author metrics (post activity + engagement aggregates) and persists scores.

### 3) Score post quality and rank per feed
A ranking job combines author score, engagement velocity, quality score, and recency decay to generate ranked candidates.

### 4) Serve feeds quickly
Ranked feed results are precomputed and served through API routes, avoiding heavy runtime ranking on each request.

### 5) Provide operational and growth tooling
The frontend and API include feed management, post composer, scheduled posts, analytics, audience insights, and notifications.

## Current Version

**v1.2.0**

## Repository Structure

- `artifacts/api-server` — Express API server
- `artifacts/cf-worker` — Cloudflare Worker + D1 runtime jobs
- `artifacts/bluesky-feeds` — React/Vite frontend
- `scripts` — developer utilities and validation scripts
- `docs` — architecture, contributing, release/runbook docs

## Local Development

```bash
pnpm install
pnpm run typecheck
pnpm run build
```

## Cloudflare Deploy (Worker)

```bash
cd artifacts/cf-worker
export CLOUDFLARE_API_TOKEN="<token>"
pnpm run db:migrate:remote:all
pnpm run deploy
```

## Quality Gates

```bash
pnpm --filter @workspace/scripts run test:author-scoring
pnpm --filter @workspace/scripts run verify:release
```
