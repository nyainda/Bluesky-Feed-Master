/**
 * feedforge-cron — Cloudflare Worker entry point for all background jobs.
 *
 * Owns:
 *   - Cron triggers (every 3 min + daily 2am cleanup)
 *   - Jetstream indexing via a short-lived WebSocket per cron tick (jetstream.ts)
 *   - All indexing, ranking, scoring, follow/unfollow automation
 *
 * Does NOT own public HTTP routes — those live in the feedforge-api worker
 * (src/index.ts) so they are served from the nearest PoP to the reader
 * rather than being anchored near D1 by Smart Placement.
 *
 * ── Why not JetstreamConsumerDO? ────────────────────────────────────────────
 * jetstream-do.ts implements a persistent Durable Object WebSocket connection.
 * That approach was reverted because Cloudflare bills incoming DO WebSocket
 * messages at 20:1 against the DO free-tier request quota (100K/day). At
 * Bluesky's actual firehose volume (~thousands of posts/min network-wide),
 * the DO exhausts its quota in hours. The cron-based approach in jetstream.ts
 * uses a plain Worker execution (not billed per-message) and is completely
 * free. Trade-off: ~3-min indexing latency vs near-real-time.
 * Keep jetstream-do.ts in the repo for a future paid-tier migration.
 */

import { runIndexer, runCleanup } from "./lib/indexer";
import { runScheduler } from "./lib/scheduler";
import { runAuthorScoring } from "./lib/author-scoring";
import { precomputeFeedRankings } from "./lib/feed-ranking";
import { runAutoUnfollow } from "./lib/auto-unfollow";
import { runAmplifier } from "./lib/amplifier";
import { runAutoAmplify } from "./lib/auto-amplify";
import { runScheduledUnfollow } from "./lib/scheduled-unfollow";
import { runQueueAllScan } from "./lib/queue-all-scan";
import { runAutoFollow } from "./lib/auto-follow";
import { runScheduledFollow, runFollowBackCheck } from "./lib/scheduled-follow";
import { runJetstreamIndexer } from "./lib/jetstream";
import { runFeedBoost } from "./lib/feed-boost";
import type { Env } from "./index";

export interface CronEnv extends Env {
  // JETSTREAM_DO binding removed — DO approach exhausts free-tier quota.
  // Re-add when on a paid Cloudflare plan: see jetstream-do.ts.
}

export default {
  async fetch(_request: Request, env: CronEnv): Promise<Response> {
    return Response.json({ status: "ok", worker: "feedforge-cron" });
  },

  async scheduled(event: ScheduledEvent, env: CronEnv, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        // Record tick timestamp for dashboard health monitoring
        await env.DB.prepare(
          "INSERT INTO cron_settings (key, value) VALUES ('last_cron_tick', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')",
        )
          .run()
          .catch(() => {});

        // ── 2am daily: cleanup old posts only ────────────────────────────
        if (event.cron === "0 2 * * *") {
          await runCleanup(env);
          return;
        }

        // ── Every 3 min: Jetstream — open WS, collect 20s, close ─────────
        // Free-tier safe: plain Worker execution, no per-message DO billing.
        // Cursor persisted in cron_settings so each tick resumes exactly where
        // the last one stopped — no event gaps, just up to ~3-min latency.
        try {
          await runJetstreamIndexer(env);
        } catch (err) {
          console.error("[cron] Jetstream indexer failed:", err instanceof Error ? err.message : String(err));
        }

        // ── 1. Drain follow/unfollow queues + advance queue-all scan ─────
        await runQueueAllScan(env);
        await runScheduledUnfollow(env);
        await runScheduledFollow(env);

        // ── 2. Search-API backfill (staggered: 1 feed/tick round-robin) ───
        await runScheduler(env);
        await runIndexer(env);

        // ── 3. Author scoring + feed ranking ─────────────────────────────
        await runAuthorScoring(env);
        await precomputeFeedRankings(env);

        // ── 4. Auto-follow discovery + follow-back check ──────────────────
        await runAutoFollow(env);
        await runFollowBackCheck(env);

        // ── 5. Auto-unfollow scan + content amplifier ─────────────────────
        await runAutoUnfollow(env);
        await runAmplifier(env);
        await runAutoAmplify(env);

        // ── 6. Feed Boost — weekly promotional posts ───────────────────────
        await runFeedBoost(env);
      })(),
    );
  },
};
