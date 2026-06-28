# Deploy Sanity Checklist (Cloudflare)

Use this before `pnpm run deploy` when you suspect Cloudflare is building an older commit.

## 1) Confirm local checkout state

```bash
git rev-parse --short HEAD
git status --short
pnpm --filter @workspace/scripts run verify:release
```

Expected output should show:
- workspace version `1.2.0` (or newer)
- notifications signature check = `true`

## 2) Push latest commit

```bash
git push origin <branch-name>
```

## 3) Run remote migrations + deploy from worker package

```bash
cd artifacts/cf-worker
export CLOUDFLARE_API_TOKEN="<token>"
pnpm run db:migrate:remote:all
pnpm run deploy
```

## 4) If CF still shows old logs

- Clear/retry build in Cloudflare dashboard.
- Confirm the deployment commit SHA shown in CF matches `git rev-parse --short HEAD`.
- Re-run `verify:release` in the exact commit checked out by CI.
