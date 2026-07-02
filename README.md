# FeedForge

> A self-hosted dashboard for managing custom Bluesky (AT Protocol) feed generators — built on Cloudflare Workers, D1, and React.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nyainda/Bluesky-Feed-Master)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-20+-green.svg)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange.svg)

> **One-click above** deploys the HTTP API worker. For the full setup (cron worker + D1 + secrets) follow the [step-by-step guide](docs/deploy-cloudflare.md).

FeedForge lets any Bluesky user run their own feed management platform — completely free using Cloudflare's generous free tier. No servers to maintain, no monthly bills for typical usage.

---

## Features

- **Feed Generator** — Create and publish custom Bluesky feeds with keyword-based indexing, author scoring, and engagement ranking
- **Audience Management** — Visualize your followers/following, discover who doesn't follow back, and run automated unfollow campaigns
- **Auto-Unfollow** — Cron-driven queue that safely drains at ~2,000 unfollows/hr — rate-limit safe, kill-proof, resumable
- **Bulk Follow** — Queue-based follow automation with configurable caps and market filters
- **Analytics** — Follower growth charts, engagement trends, and firehose activity monitoring
- **Post Composer** — Draft, schedule, and publish posts and threads to Bluesky
- **Notifications** — Monitor mentions, replies, and interactions in real time
- **Live Indexing** — Bluesky Jetstream firehose consumer (cron-based, cursor-resumable) indexes matching posts every ~3 minutes with zero event loss
- **Feed Skeleton API** — Serves `getFeedSkeleton` XRPC responses so your feeds work natively in the Bluesky app

---

## Architecture

```
┌─────────────────────────────────────────┐
│          React + Vite Dashboard          │
│         (Cloudflare Pages / Nginx)       │
└──────────────────┬──────────────────────┘
                   │ HTTPS
        ┌──────────▼──────────┐
        │   feedforge-api      │  ← HTTP Worker (Hono)
        │  Cloudflare Worker   │    All API endpoints
        └──────────┬──────────┘
                   │ D1 SQL
        ┌──────────▼──────────┐      ┌──────────────────────┐
        │   feedforge-cron     │      │   Bluesky Jetstream   │
        │  Cloudflare Worker   │◄─────│  (WebSocket, 20s/tick)│
        │  Cron: */3 * * * *  │      │  cursor-based resume  │
        │  Cron: 0 2 * * *    │      └──────────────────────┘
        └──────────┬──────────┘
                   │
        ┌──────────▼──────────┐
        │    Cloudflare D1     │  ← SQLite, shared between both workers
        └─────────────────────┘
```

Two separate Workers share one D1 database:
- **`feedforge-api`** — serves all HTTP endpoints (feeds, audience, analytics, posts, etc.)
- **`feedforge-cron`** — runs background jobs (post indexing, unfollow drain, author scoring, scheduled posts) on a 3-minute cron tick, plus a daily maintenance cron at 2 AM UTC

Both run on Cloudflare's free tier for typical single-user workloads.

---

## Quick Deploy (Cloudflare — Recommended)

See **[docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)** for the full step-by-step guide.

**Prerequisites:** Node.js 20+, pnpm, a Cloudflare account (free), a Bluesky account

```bash
# 1. Clone and install
git clone https://github.com/nyainda/Bluesky-Feed-Master.git
cd feedforge
pnpm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Create D1 database
cd artifacts/cf-worker
npx wrangler d1 create feedforge-db
# Paste the database_id into both wrangler.toml and wrangler.cron.toml

# 4. Run migrations
npx wrangler d1 execute feedforge-db --file=./migrations/0001_init.sql

# 5. Set secrets for the API worker
npx wrangler secret put BLUESKY_HANDLE        # e.g. yourhandle.bsky.social
npx wrangler secret put BLUESKY_APP_PASSWORD  # from bsky.app → Settings → App Passwords
npx wrangler secret put FEEDGEN_PUBLISHER_DID # your DID: did:plc:xxxx
npx wrangler secret put FEEDGEN_HOSTNAME      # e.g. feedforge.yourdomain.com

# 6. Set the same secrets for the cron worker
npx wrangler secret put BLUESKY_HANDLE       --config wrangler.cron.toml
npx wrangler secret put BLUESKY_APP_PASSWORD --config wrangler.cron.toml
npx wrangler secret put FEEDGEN_PUBLISHER_DID --config wrangler.cron.toml
npx wrangler secret put FEEDGEN_HOSTNAME      --config wrangler.cron.toml

# 7. Deploy both workers
npx wrangler deploy
npx wrangler deploy --config wrangler.cron.toml

# 8. Build and deploy the dashboard
cd ../bluesky-feeds
VITE_API_BASE_URL=https://feedforge-api.<your-subdomain>.workers.dev pnpm run build
npx wrangler pages deploy dist --project-name feedforge-dashboard
```

---

## Self-Hosted VPS Deploy

See **[docs/deploy-vps.md](docs/deploy-vps.md)** for the full guide using Docker, nginx, and PostgreSQL.

---

## Local Development

```bash
pnpm install

# Start the React dashboard (port 5000, proxies /api/* to CF Worker)
pnpm --filter @workspace/bluesky-feeds run dev

# Or start the local Express API stub (port 5000)
pnpm --filter @workspace/api-server run dev

# Typecheck everything
pnpm run typecheck

# Regenerate API hooks after editing lib/api-spec/openapi.yaml
pnpm --filter @workspace/api-spec run codegen
```

Copy `.env.example` → `.env.local` in `artifacts/bluesky-feeds/` and set `VITE_API_BASE_URL`.

---

## Project Structure

```
feedforge/
├── artifacts/
│   ├── bluesky-feeds/          # React + Vite dashboard (main UI)
│   ├── cf-worker/              # Cloudflare Worker (API + cron)
│   │   ├── src/
│   │   │   ├── routes/         # Hono route handlers
│   │   │   ├── lib/            # Business logic (unfollow, scoring, etc.)
│   │   │   ├── db/             # Drizzle ORM schema
│   │   │   ├── index.ts        # HTTP worker entry point
│   │   │   └── cron.ts         # Cron worker entry point
│   │   ├── wrangler.toml       # API worker config
│   │   └── wrangler.cron.toml  # Cron worker config
│   ├── api-server/             # Express server (VPS / local dev alternative)
│   └── bluesky-feeds-mobile/   # Expo mobile app (optional)
├── lib/
│   ├── api-spec/               # OpenAPI spec (source of truth for API shape)
│   ├── api-client-react/       # Auto-generated TanStack Query hooks
│   ├── api-zod/                # Auto-generated Zod schemas
│   └── db/                     # Shared Drizzle ORM config
├── docs/
│   ├── deploy-cloudflare.md    # Full Cloudflare deployment guide
│   ├── deploy-vps.md           # VPS self-hosting guide
│   └── architecture.md         # Deep-dive architecture notes
└── scripts/                    # Utility scripts
```

---

## Cloudflare Free Tier Limits

For a typical single-user instance:

| Resource | Free Limit | Typical Usage |
|---|---|---|
| Worker requests | 100,000/day | ~5,000–20,000/day |
| D1 reads | 5,000,000/day | ~50,000–200,000/day |
| D1 writes | 100,000/day | ~30,000–65,000/day |
| D1 storage | 5 GB | ~50–200 MB |
| Durable Objects | 1,000,000 req/month | **0** (not used — cron approach) |

You are very unlikely to exceed free limits running FeedForge for a single Bluesky account.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — PRs, issues, and feature requests are very welcome.

---

## License

MIT — see [LICENSE](LICENSE)
