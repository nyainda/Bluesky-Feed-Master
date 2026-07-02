# Contributing to FeedForge

Thank you for wanting to help! FeedForge is an open-source, self-hosted Bluesky feed management dashboard. Contributions of all kinds are welcome — bug fixes, features, documentation, and design improvements.

---

## Table of Contents

- [Getting started locally](#getting-started-locally)
- [Project structure](#project-structure)
- [Making changes](#making-changes)
- [Submitting a pull request](#submitting-a-pull-request)
- [Code style](#code-style)
- [Adding a new API endpoint](#adding-a-new-api-endpoint)
- [Reporting bugs](#reporting-bugs)
- [Feature requests](#feature-requests)

---

## Getting Started Locally

### Prerequisites

- **Node.js 20+**
- **pnpm** (`npm install -g pnpm`)
- A **Cloudflare account** (free) with Wrangler installed (`pnpm add -g wrangler`)
- A **Bluesky account** with an App Password (bsky.app → Settings → App Passwords)

### Setup

```bash
# Clone the repo
git clone https://github.com/your-username/feedforge.git
cd feedforge

# Install all dependencies (monorepo — installs everything)
pnpm install

# Copy the example env file
cp artifacts/bluesky-feeds/.env.example artifacts/bluesky-feeds/.env.local
# Edit .env.local and set VITE_API_BASE_URL to your CF Worker URL
# (or leave it empty to use the local Express stub)

# Start the dashboard in dev mode (hot reload, port 5000)
pnpm --filter @workspace/bluesky-feeds run dev
```

For API calls to actually work during development, you have two options:

**Option A — Point at your deployed CF Worker**
Set `VITE_API_BASE_URL=https://feedforge-api.<your-subdomain>.workers.dev` in `.env.local`. The Vite dev server proxies all `/api/*` requests there.

**Option B — Run the local Express stub**
```bash
pnpm --filter @workspace/api-server run dev
```
The Express stub mirrors the CF Worker routes but doesn't require Cloudflare credentials. Useful for UI-only changes.

---

## Project Structure

```
feedforge/
├── artifacts/
│   ├── bluesky-feeds/          # React + Vite frontend dashboard
│   │   └── src/
│   │       ├── pages/          # One file per page (Dashboard, Feeds, Audience…)
│   │       ├── components/     # Shared UI components
│   │       └── main.tsx        # Entry point
│   ├── cf-worker/              # Cloudflare Worker backend
│   │   └── src/
│   │       ├── routes/         # Hono route handlers (one file per domain)
│   │       ├── lib/            # Business logic (scoring, unfollow queue, etc.)
│   │       ├── db/             # Drizzle ORM schema and migrations
│   │       ├── index.ts        # HTTP worker entry
│   │       └── cron.ts         # Cron worker entry
│   ├── api-server/             # Express server (dev/VPS alternative to CF Worker)
│   └── bluesky-feeds-mobile/   # Expo mobile app (optional companion)
├── lib/
│   ├── api-spec/
│   │   └── openapi.yaml        # OpenAPI spec — the source of truth for all API shapes
│   ├── api-client-react/       # Auto-generated TanStack Query hooks (do not edit by hand)
│   ├── api-zod/                # Auto-generated Zod schemas (do not edit by hand)
│   └── db/                     # Shared Drizzle config
└── docs/                       # Deployment and architecture documentation
```

---

## Making Changes

### Frontend (dashboard)

All UI lives in `artifacts/bluesky-feeds/src/`. Each page is a single file in `pages/`. Components are in `components/`.

- Use **Tailwind CSS 4** utility classes for styling
- Use **TanStack Query** hooks (from `lib/api-client-react`) for data fetching — avoid raw `fetch` calls in components
- Follow existing patterns in nearby files for consistency

### Backend (CF Worker)

Routes live in `artifacts/cf-worker/src/routes/`. Each file owns one domain (feeds, audience, analytics, etc.).

- All route handlers use **Hono** — keep them thin; put business logic in `src/lib/`
- Database queries use **Drizzle ORM** with the schema in `src/db/schema.ts`
- Background work belongs in `src/cron.ts` or the relevant `src/lib/` module

### Adding a New API Endpoint

1. **Define the shape in `lib/api-spec/openapi.yaml`** — this is the single source of truth
2. **Run codegen** to regenerate hooks and Zod schemas:
   ```bash
   pnpm --filter @workspace/api-spec run codegen
   ```
3. **Implement the route** in `artifacts/cf-worker/src/routes/<domain>.ts`
4. **Register it** in `artifacts/cf-worker/src/index.ts`
5. **Mirror it** in `artifacts/api-server/src/routes/<domain>.ts` (for local dev)
6. **Use the generated hook** in the frontend

Never edit files in `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/` directly — they are overwritten by codegen.

### Database Schema Changes

1. Edit `artifacts/cf-worker/src/db/schema.ts`
2. Generate a new migration:
   ```bash
   cd artifacts/cf-worker
   npx wrangler d1 migrations create feedforge-db <migration-name>
   ```
3. Write the SQL in the generated migration file under `migrations/`
4. Apply locally:
   ```bash
   npx wrangler d1 execute feedforge-db --local --file=./migrations/<your-migration>.sql
   ```

---

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes
3. Run the typecheck to make sure nothing is broken:
   ```bash
   pnpm run typecheck
   ```
4. Commit with a clear message:
   ```
   feat: add post scheduling retry logic
   fix: correct unfollow queue pending count
   docs: update VPS deployment guide
   ```
5. Open a PR against `main` with a description of what changed and why

**PR checklist:**
- [ ] `pnpm run typecheck` passes
- [ ] New routes are registered in both the CF Worker and Express stub
- [ ] New API shapes are defined in `openapi.yaml` and codegen has been run
- [ ] New DB columns have a migration file

---

## Code Style

- **TypeScript everywhere** — no `any` unless genuinely unavoidable
- **No comments** unless the code is genuinely non-obvious
- **Prettier** for formatting — run `pnpm prettier --write .` before committing
- Keep files focused — if a file grows past ~400 lines, consider splitting it

---

## Reporting Bugs

Open a GitHub Issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your deployment type (Cloudflare / VPS)
- Any relevant error messages or console output

---

## Feature Requests

Open a GitHub Issue with the `enhancement` label. Describe:
- The problem you're trying to solve
- How you imagine it working
- Any Bluesky / AT Protocol constraints that apply

---

## Questions?

Open a Discussion on GitHub or reach out on Bluesky.
