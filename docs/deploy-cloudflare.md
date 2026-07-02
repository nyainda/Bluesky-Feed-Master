# Deploy to Cloudflare (Recommended)

This is the recommended way to run FeedForge. Both workers and the dashboard run on Cloudflare's infrastructure — completely free for typical single-user workloads.

**Time to deploy: ~15 minutes**

---

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation) (`npm install -g pnpm`)
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [Bluesky account](https://bsky.app) with an App Password
- Your Bluesky DID (find it at `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=yourhandle.bsky.social`)

---

## Step 1 — Clone and Install

```bash
git clone https://github.com/your-username/feedforge.git
cd feedforge
pnpm install
```

---

## Step 2 — Login to Cloudflare

```bash
npx wrangler login
```

This opens a browser window. Authorize Wrangler with your Cloudflare account.

---

## Step 3 — Create the D1 Database

```bash
cd artifacts/cf-worker
npx wrangler d1 create feedforge-db
```

Wrangler will print output like:
```
✅ Successfully created DB 'feedforge-db'

[[d1_databases]]
binding = "DB"
database_name = "feedforge-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` and paste it into **both** config files:

**`artifacts/cf-worker/wrangler.toml`** — find the `[[d1_databases]]` section and update `database_id`.

**`artifacts/cf-worker/wrangler.cron.toml`** — do the same.

---

## Step 4 — Run Database Migrations

```bash
# Apply all migrations to the remote D1 database
npx wrangler d1 execute feedforge-db --remote --file=./migrations/0001_init.sql
```

If there are multiple migration files, apply them in order:
```bash
for f in ./migrations/*.sql; do
  npx wrangler d1 execute feedforge-db --remote --file="$f"
done
```

---

## Step 5 — Set Secrets for the API Worker

These four secrets are required. The API worker uses them to authenticate with Bluesky and serve feed skeletons.

```bash
# Your Bluesky handle (e.g. yourname.bsky.social)
npx wrangler secret put BLUESKY_HANDLE

# Your Bluesky App Password (NOT your account password)
# Create one at: bsky.app → Settings → App Passwords
npx wrangler secret put BLUESKY_APP_PASSWORD

# Your Bluesky DID (e.g. did:plc:abc123...)
npx wrangler secret put FEEDGEN_PUBLISHER_DID

# The hostname where your feeds will be served
# e.g. feedforge.yourdomain.com  or  feedforge-api.<subdomain>.workers.dev
npx wrangler secret put FEEDGEN_HOSTNAME
```

Each command prompts you to type (or paste) the value securely — it is never shown again.

---

## Step 6 — Set Secrets for the Cron Worker

The cron worker needs the same secrets. Note the `--config` flag.

```bash
npx wrangler secret put BLUESKY_HANDLE        --config wrangler.cron.toml
npx wrangler secret put BLUESKY_APP_PASSWORD  --config wrangler.cron.toml
npx wrangler secret put FEEDGEN_PUBLISHER_DID --config wrangler.cron.toml
npx wrangler secret put FEEDGEN_HOSTNAME      --config wrangler.cron.toml
```

---

## Step 7 — Deploy Both Workers

```bash
# Deploy the HTTP API worker
npx wrangler deploy

# Deploy the cron worker (runs every 3 min + daily at 2 AM UTC)
npx wrangler deploy --config wrangler.cron.toml
```

After deployment, Wrangler prints the worker URLs:
- API worker: `https://feedforge-api.<your-subdomain>.workers.dev`
- Cron worker: `https://feedforge-cron.<your-subdomain>.workers.dev` (HTTP not used — cron only)

Note the API worker URL — you'll need it for the dashboard.

---

## Step 8 — Build and Deploy the Dashboard

```bash
cd ../bluesky-feeds

# Build the React dashboard, pointing it at your deployed API worker
VITE_API_BASE_URL=https://feedforge-api.<your-subdomain>.workers.dev pnpm run build

# Deploy to Cloudflare Pages (creates a new project on first run)
npx wrangler pages deploy dist --project-name feedforge-dashboard
```

Wrangler prints the Pages URL, e.g. `https://feedforge-dashboard.pages.dev`.

---

## Step 9 — Register Your Feeds on Bluesky

For each feed you create in the dashboard, you need to register it with Bluesky so it appears in the app.

The dashboard Settings page shows the exact commands. Generally:

```bash
# The feed skeleton endpoint must be reachable at:
# https://<FEEDGEN_HOSTNAME>/xrpc/app.bsky.feed.getFeedSkeleton
```

Use the Bluesky client or the Settings page in the dashboard to publish each feed's `generatorView`.

---

## Custom Domain (Optional)

To use `feedforge.yourdomain.com` instead of the `workers.dev` subdomain:

1. Add your domain to Cloudflare (free — just change nameservers)
2. In the Cloudflare dashboard → Workers → feedforge-api → Settings → Domains & Routes
3. Add a custom domain, e.g. `api.feedforge.yourdomain.com`
4. Update `FEEDGEN_HOSTNAME` secret to match
5. Redeploy

---

## Updating

```bash
git pull
pnpm install
cd artifacts/cf-worker
npx wrangler deploy
npx wrangler deploy --config wrangler.cron.toml
cd ../bluesky-feeds
VITE_API_BASE_URL=https://feedforge-api.<your-subdomain>.workers.dev pnpm run build
npx wrangler pages deploy dist --project-name feedforge-dashboard
```

If the update includes new migrations, run them first:
```bash
npx wrangler d1 execute feedforge-db --remote --file=./migrations/<new-migration>.sql
```

---

## Troubleshooting

**Dashboard shows "API not reachable"**
- Check `VITE_API_BASE_URL` is correct and the API worker is deployed
- Visit `https://feedforge-api.<subdomain>.workers.dev/api/healthz` — should return `{"ok":true}`

**Unfollow queue not draining**
- The cron worker needs credentials too — confirm Step 6 was completed
- Check the Audience page → Auto-Unfollow card → "Last drain" telemetry
- Visit the Cloudflare dashboard → Workers → feedforge-cron → Logs

**Feed not appearing in Bluesky app**
- `FEEDGEN_HOSTNAME` must be publicly reachable and match what's registered with Bluesky
- The `/.well-known/did.json` endpoint must return your publisher DID

**D1 write limits**
- FeedForge is optimized to stay well within the 100k writes/day free limit (~65k typical)
- If you're indexing very high-volume feeds, reduce the keyword set or scoring frequency
