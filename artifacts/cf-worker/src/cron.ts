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

// Runs a single cron job in isolation so one job throwing (e.g. hitting the
// free-tier 50-subrequest cap) can't silently prevent every later job in the
// same tick from running. Previously all jobs in a tick were awaited back-to-
// back with no try/catch — one failure meant everything after it that tick
// (including feed indexing/ranking, or the unfollow drain) simply never ran,
// which looked like random freezes and feeds only updating on manual trigger.
async function runJob(env: CronEnv, name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron] Job "${name}" failed (isolated — other jobs still ran):`, message);
    await env.DB.prepare(
      `INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
      .bind(`last_job_error_${name}`, `${new Date().toISOString()} :: ${message}`)
      .run()
      .catch(() => {});
  }
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
        // Each Bluesky API call AND each D1 query here counts against the same
        // 50-subrequest-per-invocation free-tier cap. Every job below runs in
        // isolation via runJob() — one job hitting the cap no longer prevents
        // the rest from running this tick. On top of that, the 6 jobs are split
        // across 4 rotating slots (not 2) because `scheduled_unfollow` alone
        // (login + up to N items x deleteFollow/getProfile/D1-update + setup
        // queries) can approach ~40-50 subrequests by itself — stacking ANY
        // other job on the same tick reliably blew the cap. It now gets a
        // fully dedicated tick every 4th SOCIAL_CRON fire (~12 min).
        if (event.cron === SOCIAL_CRON) {
          await recordTick(env, "last_cron_tick_social");
          const minute = new Date(event.scheduledTime).getUTCMinutes();
          const tickIndex = Math.floor((minute - 1) / 3); // 0,1,2,3... for minutes 1,4,7,10...
          const slot = tickIndex % 4;

          if (slot === 0) {
            // Dedicated slot — heaviest single job, no sharing.
            await runJob(env, "scheduled_unfollow", () => runScheduledUnfollow(env));
          } else if (slot === 1) {
            await runJob(env, "scheduled_follow", () => runScheduledFollow(env));
            await runJob(env, "follow_back_check", () => runFollowBackCheck(env));
          } else if (slot === 2) {
            await runJob(env, "queue_all_scan", () => runQueueAllScan(env));
            await runJob(env, "auto_unfollow", () => runAutoUnfollow(env));
          } else {
            await runJob(env, "auto_follow", () => runAutoFollow(env));
            await runJob(env, "amplifier", () => runAmplifier(env));
          }
          return;
        }

        // ── CONTENT_CRON: indexing/scoring/ranking/posting — CPU-constrained ────
        // Each job runs in isolation via runJob() — previously a single throw
        // (e.g. from runScheduler) silently skipped runIndexer/precomputeFeedRankings
        // for the rest of that tick.
        //
        // More importantly: Workers Free plan has a fixed, non-configurable
        // 10ms *active CPU* budget per invocation (I/O waits are free, but
        // JSON parsing of Bluesky API responses and D1 row mapping are not).
        // Running all 7 jobs back-to-back in one invocation reliably hit
        // "Exceeded CPU Limit" mid-tick and silently killed the entire
        // invocation (not just one job) — this is the real reason feeds
        // sometimes only picked up new posts after a manual "trigger-index".
        //
        // Fix: keep only the two cheapest, most latency-sensitive jobs
        // (scheduler, indexer) on every tick, and rotate the 4 heavier
        // compute jobs one-at-a-time across ticks so no single invocation
        // does more than ~2-3 jobs of CPU work.
        if (event.cron === CONTENT_CRON) {
          await recordTick(env, "last_cron_tick_content");
          await runJob(env, "scheduler", () => runScheduler(env));
          await runJob(env, "indexer", () => runIndexer(env));

          const minute = new Date(event.scheduledTime).getUTCMinutes();
          const tickIndex = Math.floor((minute - 2) / 3); // 0,1,2,3... for minutes 2,5,8,11...
          const slot = ((tickIndex % 4) + 4) % 4;

          if (slot === 0) {
            await runJob(env, "author_scoring", () => runAuthorScoring(env));
          } else if (slot === 1) {
            await runJob(env, "feed_ranking", () => precomputeFeedRankings(env));
          } else if (slot === 2) {
            await runJob(env, "auto_amplify", () => runAutoAmplify(env));
          } else {
            await runJob(env, "feed_boost", () => runFeedBoost(env));
          }

          // Cheap no-op unless it's actually the cleanup hour, so safe every tick.
          await runJob(env, "daily_cleanup", () => runDailyCleanupIfDue(env));
          return;
        }

        console.error(`[cron] Unrecognized cron trigger: ${event.cron}`);
      })(),
    );
  },
};
