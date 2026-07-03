/**
 * feedforge-cron — Cloudflare Worker entry point for all background jobs.
 *
 * Owns:
 *   - Cron triggers, split by resource profile so each invocation gets its
 *     own fresh 10ms CPU / 50-subrequest budget (see "Why split?" below)
 *   - Jetstream indexing via a short-lived WebSocket per cron tick (jetstream.ts)
 *   - All indexing, ranking, scoring, follow/unfollow automation
 *
 * Does NOT own public HTTP routes — those live in the feedforge-api worker
 * (src/index.ts) so they are served from the nearest PoP to the reader
 * rather than being anchored near D1 by Smart Placement.
 *
 * ── Why split the cron into separate schedules? ─────────────────────────────
 * Previously every job (jetstream, follow/unfollow queue drains, indexing,
 * scoring, ranking, auto-follow) ran inside ONE cron invocation on the free
 * tier's shared per-invocation budget (10ms CPU, 50 subrequests). CPU-heavy
 * jetstream and subrequest-heavy follow/unfollow draining were competing for
 * the same scraps — fixing one job's resource usage just exposed the next
 * job's contention. Splitting into independent schedules gives each resource
 * profile its own fresh budget per tick:
 *   - JETSTREAM_CRON:  CPU-heavy firehose consumption, isolated from the rest.
 *   - SOCIAL_CRON:     subrequest-heavy follow/unfollow queue draining and
 *                      discovery (each Bluesky API call is a subrequest).
 *   - CONTENT_CRON:    D1-heavy indexing/scoring/ranking + low-volume posting.
 * NOTE: this account's actual Workers Free plan cap is 3 cron triggers total
 * (confirmed empirically via the Cloudflare API — not the 5 the generic docs
 * error message points to). That's exactly one trigger per resource group,
 * so the daily cleanup no longer gets its own trigger — it's folded into the
 * CONTENT_CRON tick, gated by a once-per-day check against `cron_settings`.
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

// ── Cron schedule constants — must match wrangler.cron.toml [triggers] ──────
const JETSTREAM_CRON = "*/3 * * * *";
const SOCIAL_CRON = "1-59/3 * * * *";
const CONTENT_CRON = "2-59/3 * * * *";

// Cleanup runs once/day gated inside CONTENT_CRON (no dedicated trigger —
// this account's cron trigger cap is 3 total, one per resource group).
const CLEANUP_HOUR_UTC = 2;

async function recordTick(env: CronEnv, key: string) {
  await env.DB.prepare(
    `INSERT INTO cron_settings (key, value) VALUES (?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')`,
  )
    .bind(key)
    .run()
    .catch(() => {});
}

async function runDailyCleanupIfDue(env: CronEnv) {
  const now = new Date();
  if (now.getUTCHours() !== CLEANUP_HOUR_UTC) return;

  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const row = await env.DB.prepare("SELECT value FROM cron_settings WHERE key = 'last_cleanup_date'")
    .first<{ value: string }>()
    .catch(() => null);
  if (row?.value === today) return; // already ran today

  await runCleanup(env);
  await env.DB.prepare(
    `INSERT INTO cron_settings (key, value) VALUES ('last_cleanup_date', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  )
    .bind(today)
    .run()
    .catch(() => {});
}

export default {
  async fetch(_request: Request, env: CronEnv): Promise<Response> {
    return Response.json({ status: "ok", worker: "feedforge-cron" });
  },

  async scheduled(event: ScheduledEvent, env: CronEnv, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        // Record overall + per-group tick timestamps for dashboard health
        // monitoring. `last_cron_tick` is updated on every trigger fire (any
        // group) for back-compat; the per-group keys let cron-health detect
        // a stall in one job family even while the others keep ticking.
        await recordTick(env, "last_cron_tick");

        // ── JETSTREAM_CRON: firehose indexing — CPU-heavy, isolated ──────
        // Free-tier safe: plain Worker execution, no per-message DO billing.
        // Cursor persisted in cron_settings so each tick resumes exactly
        // where the last one stopped — no event gaps, just ~3-min latency.
        if (event.cron === JETSTREAM_CRON) {
          await recordTick(env, "last_cron_tick_jetstream");
          try {
            await runJetstreamIndexer(env);
          } catch (err) {
            console.error("[cron] Jetstream indexer failed:", err instanceof Error ? err.message : String(err));
          }
          return;
        }

        // ── SOCIAL_CRON: follow/unfollow queues + discovery — subrequest-heavy ──
        // Each Bluesky API call here is a subrequest; this schedule gets its
        // own fresh 50-subrequest budget instead of sharing it with jetstream.
        if (event.cron === SOCIAL_CRON) {
          await recordTick(env, "last_cron_tick_social");
          await runQueueAllScan(env);
          await runScheduledUnfollow(env);
          await runScheduledFollow(env);
          await runFollowBackCheck(env);
          await runAutoFollow(env);
          await runAutoUnfollow(env);
          await runAmplifier(env);
          return;
        }

        // ── CONTENT_CRON: indexing/scoring/ranking/posting — D1-heavy ────
        // Mostly D1 reads/writes plus low-volume posting; safe to share one
        // schedule since it rarely touches the subrequest budget.
        if (event.cron === CONTENT_CRON) {
          await recordTick(env, "last_cron_tick_content");
          await runScheduler(env);
          await runIndexer(env);
          await runAuthorScoring(env);
          await precomputeFeedRankings(env);
          await runAutoAmplify(env);
          await runFeedBoost(env);
          await runDailyCleanupIfDue(env);
          return;
        }

        console.error(`[cron] Unrecognized cron trigger: ${event.cron}`);
      })(),
    );
  },
};
