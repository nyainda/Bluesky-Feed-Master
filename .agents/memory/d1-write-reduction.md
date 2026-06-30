---
name: D1 free-tier write reduction
description: How FeedForge CF Worker was brought under the 100K writes/day D1 free limit.
---

## The rule
Three targeted changes reduce D1 writes from ~650K/day to ~65K/day:

1. **Feed ranking cooldown** (`feed-ranking.ts`): `precomputeFeedRankings` now skips if run within 14 minutes (stored in `cron_settings` key `last_ranking_run`). This cuts ranking from 480 runs/day → ~103 runs/day. **Default candidateLimit also reduced 200 → 50.**
2. **Batch markAuthorDirty** (`author-scoring.ts`): `batchMarkAuthorsDirty(env, dids[])` exported. `indexer.ts`, `jetstream.ts`, and `jetstream-do.ts` collect all dirty author DIDs per flush/batch and call this once instead of once per indexed post.
3. **Author scoring batch size**: Default `batchSize` reduced 50 → 20 (each author = 2 writes; 20 × 2 × 480 = 19,200/day vs old 48,000).

## Why
D1 free tier = 100,000 row writes/day. Old code: 5 feeds × 201 writes (DELETE + 200 INSERTs) × 480 cron ticks = 482,400 writes/day from ranking alone, plus ~170K more from author scoring and per-post markAuthorDirty.

## How to apply
- If adding new per-row cron operations, check if they can be batched with `env.DB.batch()`.
- If extending feed ranking candidates, be aware each extra candidate = 1 extra D1 write × 103 runs/day × N feeds.
- The 14-min ranking cooldown means rankings lag up to 14 min behind new posts — acceptable for a feed generator.
- `batchMarkAuthorsDirty` must be kept in sync with `markAuthorDirty` (which now delegates to batch internally).
