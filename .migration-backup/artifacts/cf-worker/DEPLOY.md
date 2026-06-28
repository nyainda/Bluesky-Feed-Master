# FeedForge — Cloudflare Worker Deployment Guide

## ✅ DEPLOYED
- **Worker:** https://feedforge-api.manmysterious2020.workers.dev
- **Health:** https://feedforge-api.manmysterious2020.workers.dev/api/healthz
- **DID doc:** https://feedforge-api.manmysterious2020.workers.dev/.well-known/did.json
- **D1 database:** feedforge-db (`6d1329cc-e8b9-4183-bbf6-42ede9a83b74`)
- **Cron:** Every 3 minutes

---

Complete 100% free stack: Cloudflare Workers (API) + D1 (database) + Pages (frontend).
Posts are indexed via Cron Triggers every 3 minutes instead of a real-time firehose.

---

## Prerequisites

- A free Cloudflare account → https://cloudflare.com
- Node.js 18+ installed locally
- `pnpm` installed (`npm install -g pnpm`)

---

## Step 1 — Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

---

## Step 2 — Create the D1 Database

```bash
cd artifacts/cf-worker
pnpm install
wrangler d1 create feedforge-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "feedforge-db"
database_id = "PASTE_YOUR_ID_HERE"   # <-- replace this
```

---

## Step 3 — Run the Database Migration

```bash
# Local dev
wrangler d1 execute feedforge-db --file ./migrations/0001_init.sql

# Production (remote D1)
wrangler d1 execute feedforge-db --remote --file ./migrations/0001_init.sql
```

---

## Step 4 — Set Secrets

```bash
wrangler secret put FEEDGEN_PUBLISHER_DID
# → Paste: did:plc:oobxeg4vljlqpp62k7fd6flp

wrangler secret put BLUESKY_HANDLE
# → Paste: bruceoyugi.bsky.social

wrangler secret put BLUESKY_APP_PASSWORD
# → Paste: your app password from bsky.app/settings/app-passwords

wrangler secret put FEEDGEN_HOSTNAME
# → Paste AFTER deploying (Step 5), e.g.: feedforge-api.your-name.workers.dev
```

---

## Step 5 — Deploy the Worker

```bash
wrangler deploy
```

You'll get a URL like `feedforge-api.your-name.workers.dev`. Set that as `FEEDGEN_HOSTNAME`:

```bash
wrangler secret put FEEDGEN_HOSTNAME
# → feedforge-api.your-name.workers.dev
```

---

## Step 6 — Deploy the Frontend to Cloudflare Pages

1. Push this repo to GitHub
2. Go to https://pages.cloudflare.com → "Create a project" → connect your repo
3. Build settings:
   - **Framework preset**: Vite
   - **Build command**: `pnpm --filter @workspace/bluesky-feeds run build`
   - **Build output directory**: `artifacts/bluesky-feeds/dist`
4. Environment variables → Add:
   - `VITE_API_BASE_URL` = `https://feedforge-api.your-name.workers.dev`
5. Deploy!

---

## Step 7 — Verify

After deploying, check these URLs work:

```
# Worker health
curl https://feedforge-api.your-name.workers.dev/api/healthz

# DID document (required by Bluesky)
curl https://feedforge-api.your-name.workers.dev/.well-known/did.json

# Feed skeleton (replace with your feed name)
curl "https://feedforge-api.your-name.workers.dev/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://did:plc:xxx/app.bsky.feed.generator/my-feed"
```

---

## How the Cron Indexer Works

Every 3 minutes, Cloudflare automatically calls the `scheduled` handler in `src/index.ts`.
It runs through all active feeds, fetches their keywords, and calls Bluesky's `searchPosts` API
for each keyword. New posts are upserted into D1.

- Posts appear in feeds within ~3 minutes of being posted to Bluesky
- No persistent server required — fully serverless
- Free tier: 100,000 Worker requests/day, 5 million D1 rows read/day

---

## Local Development

Create a `.dev.vars` file (git-ignored) in `artifacts/cf-worker/`:

```
FEEDGEN_PUBLISHER_DID=did:plc:oobxeg4vljlqpp62k7fd6flp
BLUESKY_HANDLE=bruceoyugi.bsky.social
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
FEEDGEN_HOSTNAME=localhost:8787
```

Then run:

```bash
wrangler dev
```

The API will be available at `http://localhost:8787`.
