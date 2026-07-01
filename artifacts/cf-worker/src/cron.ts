/**
 * feedforge-cron — Cloudflare Worker entry point for all background jobs.
 *
 * Owns:
 *   - Cron triggers (every 3 min + daily 2am cleanup)
 *   - JetstreamConsumerDO (persistent Jetstream WebSocket via Durable Object)
 *   - All indexing, ranking, scoring, follow/unfollow automation
 *
 * Does NOT own public HTTP routes — those live in the feedforge-api worker
 * (src/index.ts) so they are served from the nearest PoP to the reader
 * rather than being anchored near D1 by Smart Placement.
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
import { JetstreamConsumerDO } from "./lib/jetstream-do";
import type { Env } from "./index";

export { JetstreamConsumerDO };

export interface CronEnv extends Env {
  JETSTREAM_DO: DurableObjectNamespace;
}

const DO_NAME = "singleton";

export default {
  async fetch(_request: Request, env: CronEnv): Promise<Response> {
    // Minimal HTTP surface — just a health check so monitoring can verify
    // the cron worker is deployed and reachable
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

        // ── Every 3 min: ping Jetstream DO to ensure persistent connection ─
        // The DO opens a single WebSocket that stays alive indefinitely.
        // This ping just health-checks it and reconnects if the DO was evicted.
        try {
          const doId = env.JETSTREAM_DO.idFromName(DO_NAME);
          const stub = env.JETSTREAM_DO.get(doId);
          const resp = await stub.fetch("https://do-internal/ping");
          const data = (await resp.json()) as {
            status: string;
            cursorLagSeconds: number | null;
          };
          console.log(
            `[cron] Jetstream DO: ${data.status}, lag=${data.cursorLagSeconds ?? "n/a"}s`,
          );
        } catch (err) {
          console.error(
            "[cron] Jetstream DO ping failed:",
            err instanceof Error ? err.message : String(err),
          );
        }

        // ── 1. Drain follow/unfollow queues + advance queue-all scan ─────
        await runQueueAllScan(env);   // cursor-based: 20 pages/tick, resumes on CF kill
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
      })(),
    );
  },
};
