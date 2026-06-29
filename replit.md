# FeedForge

A comprehensive dashboard for managing, indexing, and serving custom feeds for the Bluesky (AT Protocol) social network. Includes feed management, post indexing, audience analytics, automated social interactions, and content syndication tools.

## Run & Operate

- `pnpm --filter @workspace/bluesky-feeds run dev` — run the web dashboard (port 3000)
- `pnpm --filter @workspace/api-server run dev` — run the local API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `VITE_API_BASE_URL` — Cloudflare Worker API base URL (set in `.replit` userenv)

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- Frontend: React 19, Vite, Tailwind CSS 4, Wouter (routing), TanStack Query
- API: Express 5 (local server), Hono (Cloudflare Worker)
- DB: PostgreSQL + Drizzle ORM (local), D1/SQLite (Worker)
- Validation: Zod, drizzle-zod
- Bluesky: @atproto/api
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `artifacts/bluesky-feeds/` — React + Vite web dashboard (main UI)
- `artifacts/cf-worker/` — Cloudflare Worker (core API + cron jobs)
- `artifacts/api-server/` — Express server (local dev alternative)
- `artifacts/bluesky-feeds-mobile/` — Expo mobile app
- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `lib/api-client-react/` — Auto-generated React hooks
- `lib/api-zod/` — Auto-generated Zod schemas
- `lib/db/` — Shared Drizzle ORM config and schemas

## Architecture decisions

- The frontend talks directly to the Cloudflare Worker API (`VITE_API_BASE_URL`); the local Express server is for development fallback only.
- All API shapes are defined in `lib/api-spec/openapi.yaml` and codegen'd — never edit generated files directly.
- Authentication is handled via Bluesky AT Protocol directly (no separate auth system).

## Product

FeedForge lets Bluesky users create and manage custom feed generators, track analytics, manage their social graph (follow/unfollow automation), compose and schedule posts, and monitor feed indexing activity in real time.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any changes to `lib/api-spec/openapi.yaml`.
- The Cloudflare Worker deploys separately via `wrangler` — it is not part of the Replit workflow.
- `VITE_API_BASE_URL` is set in `.replit` under `[userenv.shared]` and points to the deployed Worker.
