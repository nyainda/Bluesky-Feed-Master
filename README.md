# FeedForge (Bluesky Feed Master)

A monorepo for building and running a custom Bluesky feed platform with:
- API server
- Cloudflare Worker
- React frontend
- async author scoring + ranked feed precompute pipeline

## Current App Version

**v1.2.0**

## Quick Start

```bash
pnpm install
pnpm run typecheck
pnpm run build
```

## Deploy (Cloudflare Worker)

```bash
cd artifacts/cf-worker
export CLOUDFLARE_API_TOKEN="<token>"
pnpm run db:migrate:remote:all
pnpm run deploy
```

## Notes

If your GitHub repository **About** section still shows old Replit text, that value is managed in GitHub UI (not from code files). Update it from:

**GitHub Repo → About (gear icon) → Description / Website**
