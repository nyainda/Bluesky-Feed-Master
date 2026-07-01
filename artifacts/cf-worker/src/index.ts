import { Hono } from "hono";
import { cors } from "hono/cors";
import feedsRoute from "./routes/feeds";
import postsRoute from "./routes/posts";
import statsRoute from "./routes/stats";
import analyticsRoute from "./routes/analytics";
import audienceRoute from "./routes/audience";
import composeRoute from "./routes/compose";
import notificationsRoute from "./routes/notifications";
import xrpcRoute from "./routes/xrpc";
import cronSettingsRoute from "./routes/cron-settings";
import syndicationRoute from "./routes/syndication";
import followSettingsRoute from "./routes/follow-settings";
import { runIndexer } from "./lib/indexer";
import { runJetstreamIndexer } from "./lib/jetstream";
import { precomputeFeedRankings } from "./lib/feed-ranking";
import { runAutoUnfollow } from "./lib/auto-unfollow";
import { runScheduledUnfollow } from "./lib/scheduled-unfollow";
import { runAutoFollow } from "./lib/auto-follow";
import { runScheduledFollow } from "./lib/scheduled-follow";

export interface Env {
  DB: D1Database;
  FEEDGEN_HOSTNAME: string;
  FEEDGEN_PUBLISHER_DID: string;
  BLUESKY_HANDLE: string;
  BLUESKY_APP_PASSWORD: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/api/healthz", (c) => c.json({ status: "ok", runtime: "cloudflare-workers" }));

// Migration endpoint — idempotent table setup
app.post("/api/admin/migrate", async (c) => {
  try {
    const db = c.env.DB;
    await db.prepare("CREATE TABLE IF NOT EXISTS follower_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, followers_count INTEGER NOT NULL, follows_count INTEGER NOT NULL, posts_count INTEGER NOT NULL, recorded_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    // Drop old scheduled_posts if it has wrong schema (thread_posts / posted_at columns), then recreate
    const tableInfo = await db.prepare("PRAGMA table_info(scheduled_posts)").all();
    const cols = (tableInfo.results as Array<{ name: string }>).map(r => r.name);
    if (cols.includes("thread_posts") || cols.includes("posted_at")) {
      await db.prepare("DROP TABLE scheduled_posts").run();
    }
    await db.prepare("CREATE TABLE IF NOT EXISTS scheduled_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, thread_parts TEXT, is_thread INTEGER NOT NULL DEFAULT 0, scheduled_at TEXT NOT NULL, sent_at TEXT, status TEXT NOT NULL DEFAULT 'pending', error_message TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS cron_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS syndication_platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, label TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS syndication_log (id INTEGER PRIMARY KEY AUTOINCREMENT, post_uri TEXT NOT NULL, platform_id INTEGER NOT NULL DEFAULT 0, platform TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', external_id TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS amplification_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, post_uri TEXT NOT NULL, post_cid TEXT NOT NULL, post_text TEXT NOT NULL DEFAULT '', amplify_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', done_at TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS auto_unfollow_log (id INTEGER PRIMARY KEY AUTOINCREMENT, did TEXT NOT NULL, handle TEXT NOT NULL DEFAULT '', unfollowed_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_auto_unfollow_log_unfollowed_at ON auto_unfollow_log (unfollowed_at DESC)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS unfollow_scheduled_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, did TEXT NOT NULL UNIQUE, follow_uri TEXT, status TEXT NOT NULL DEFAULT 'pending', queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS auto_follow_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, did TEXT NOT NULL UNIQUE, handle TEXT NOT NULL DEFAULT '', followers_count INTEGER NOT NULL DEFAULT 0, market TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS auto_follow_log (id INTEGER PRIMARY KEY AUTOINCREMENT, did TEXT NOT NULL UNIQUE, handle TEXT NOT NULL DEFAULT '', followers_count INTEGER NOT NULL DEFAULT 0, market TEXT NOT NULL DEFAULT '', followed_at TEXT NOT NULL DEFAULT (datetime('now')), follow_back_status TEXT NOT NULL DEFAULT 'pending', follow_back_checked_at TEXT, unfollow_queued_at TEXT)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_auto_follow_log_followed_at ON auto_follow_log (followed_at DESC)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS authors (did TEXT PRIMARY KEY, needs_recalc INTEGER NOT NULL DEFAULT 0, recalc_attempts INTEGER NOT NULL DEFAULT 0, next_recalc_at TEXT NOT NULL DEFAULT (datetime('now')), last_scored_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS author_scores (did TEXT PRIMARY KEY REFERENCES authors(did) ON DELETE CASCADE, score INTEGER NOT NULL DEFAULT 0, post_count INTEGER NOT NULL DEFAULT 0, total_likes INTEGER NOT NULL DEFAULT 0, total_reposts INTEGER NOT NULL DEFAULT 0, total_replies INTEGER NOT NULL DEFAULT 0, formula_version TEXT NOT NULL DEFAULT 'v1', updated_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS feed_ranked_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, post_uri TEXT NOT NULL REFERENCES indexed_posts(uri) ON DELETE CASCADE, rank INTEGER NOT NULL, final_score REAL NOT NULL DEFAULT 0, quality_score REAL NOT NULL DEFAULT 0, computed_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS feed_ranked_posts_feed_post_unique ON feed_ranked_posts (feed_id, post_uri)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_feed_ranked_posts_feed_rank ON feed_ranked_posts (feed_id, rank)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_feed_ranked_posts_post_uri ON feed_ranked_posts (post_uri)").run();
    // Add avatar_url column to feeds if not present (safe re-run)
    try { await db.prepare("ALTER TABLE feeds ADD COLUMN avatar_url TEXT").run(); } catch { /* already exists */ }
    return c.json({ ok: true, message: "Migration applied successfully" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

app.get("/api/config/status", (c) =>
  c.json({
    FEEDGEN_HOSTNAME: Boolean(c.env.FEEDGEN_HOSTNAME),
    FEEDGEN_PUBLISHER_DID: Boolean(c.env.FEEDGEN_PUBLISHER_DID),
    BLUESKY_HANDLE: Boolean(c.env.BLUESKY_HANDLE),
    BLUESKY_APP_PASSWORD: Boolean(c.env.BLUESKY_APP_PASSWORD),
    DATABASE_URL: true,
  }),
);

// Firehose status stub — CF Worker indexes via scheduled cron, not WebSocket
app.get("/api/firehose/status", (c) =>
  c.json({
    connected: false,
    mode: "cron",
    reconnectCount: 0,
    postsIndexedTotal: 0,
    message: "Indexing runs every 3 minutes via Cloudflare scheduled cron",
  }),
);

// Debug — test full search+insert pipeline for one feed and one keyword
app.get("/api/admin/debug-index-feed", async (c) => {
  const feedId = parseInt(c.req.query("feedId") ?? "4", 10);
  const keyword = c.req.query("keyword") ?? "ai";
  try {
    const { createDb: mkDb, feedsTable: ft, indexedPostsTable: ipt } = await import("./db");
    const db = mkDb(c.env.DB);
    const { eq, sql: drizzleSql, count: cnt } = await import("drizzle-orm");

    const [feed] = await db.select().from(ft).where(eq(ft.id, feedId));
    if (!feed) return c.json({ error: `feed ${feedId} not found` }, 404);

    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.login({ identifier: c.env.BLUESKY_HANDLE, password: c.env.BLUESKY_APP_PASSWORD });

    const result = await agent.app.bsky.feed.searchPosts({ q: keyword, limit: 5, sort: "latest" });
    const posts = result.data.posts;
    const algoTag = feed.recordName;
    const insertResults: string[] = [];

    for (const post of posts) {
      try {
        await db.insert(ipt).values({
          uri: post.uri, cid: post.cid, author: post.author.did,
          text: (post.record as { text?: string }).text ?? "",
          algoTags: algoTag, indexedAt: new Date().toISOString(),
          likes: post.likeCount ?? 0, reposts: post.repostCount ?? 0,
          replies: post.replyCount ?? 0, quotes: post.quoteCount ?? 0,
        }).onConflictDoUpdate({
          target: ipt.uri,
          set: {
            algoTags: drizzleSql`CASE WHEN instr(',' || algo_tags || ',', ',' || ${algoTag} || ',') > 0 THEN algo_tags ELSE algo_tags || ',' || ${algoTag} END`,
            likes: post.likeCount ?? 0,
          },
        });
        insertResults.push(`OK: ${post.uri.slice(-16)}`);
      } catch (e) {
        insertResults.push(`ERR: ${post.uri.slice(-16)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const [{ count: postCount }] = await db.select({ count: cnt() }).from(ipt)
      .where(drizzleSql`instr(',' || ${ipt.algoTags} || ',', ',' || ${algoTag} || ',') > 0`);

    return c.json({ feed: feed.recordName, keyword, postsFound: posts.length, insertResults, postCountAfter: postCount });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// One-off cleanup — dedupes any algo_tags rows already corrupted with repeats
// e.g. "tech,tech,startups" → "tech,startups". Safe to run multiple times.
app.post("/api/admin/dedup-tags", async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      "SELECT uri, algo_tags FROM indexed_posts WHERE algo_tags LIKE '%,%'"
    ).all<{ uri: string; algo_tags: string }>();

    let fixed = 0;
    const stmts: D1PreparedStatement[] = [];

    for (const row of rows.results) {
      const tags = row.algo_tags.split(",").map((t) => t.trim()).filter(Boolean);
      const deduped = [...new Set(tags)].join(",");
      if (deduped !== row.algo_tags) {
        stmts.push(
          c.env.DB.prepare("UPDATE indexed_posts SET algo_tags = ? WHERE uri = ?")
            .bind(deduped, row.uri)
        );
        fixed++;
      }
    }

    if (stmts.length > 0) {
      // Batch in groups of 100 to stay within D1 batch limits
      for (let i = 0; i < stmts.length; i += 100) {
        await c.env.DB.batch(stmts.slice(i, i + 100));
      }
    }

    return c.json({
      ok: true,
      scanned: rows.results.length,
      fixed,
      message: `Deduped ${fixed} rows out of ${rows.results.length} scanned`,
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Manual trigger — runs feed ranking immediately (separate from indexer to avoid cron timeout)
app.post("/api/admin/trigger-rank", async (c) => {
  const start = Date.now();
  try {
    await precomputeFeedRankings(c.env);
    const elapsed = Math.round((Date.now() - start) / 1000);
    return c.json({ ok: true, message: `Feed ranking completed in ${elapsed}s` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

// Manual trigger — bypasses the interval gate; scans following/followers, queues
// non-followers-back, then starts draining the queue. Uses waitUntil so we
// return immediately and the CF worker keeps running in the background.
app.post("/api/admin/trigger-scan", async (c) => {
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await runAutoUnfollow(c.env, { force: true });
        await runScheduledUnfollow(c.env);
        console.log("[trigger-scan] Completed");
      } catch (err) {
        console.error("[trigger-scan] Error:", err instanceof Error ? err.message : String(err));
      }
    })(),
  );
  return c.json({ ok: true, message: "Scan started — queue status will update within seconds" });
});

// Manual trigger — runs auto-follow discovery + drains the follow queue immediately
app.post("/api/admin/trigger-follow", async (c) => {
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await runAutoFollow(c.env, { force: true });
        await runScheduledFollow(c.env);
        console.log("[trigger-follow] Completed");
      } catch (err) {
        console.error("[trigger-follow] Error:", err instanceof Error ? err.message : String(err));
      }
    })(),
  );
  return c.json({ ok: true, message: "Auto-follow discovery + drain started — queue status will update within seconds" });
});

// Manual retry — re-queues all failed unfollow items as pending so the next cron picks them up
app.post("/api/admin/retry-failed-unfollows", async (c) => {
  try {
    const result = await c.env.DB.prepare(
      `UPDATE unfollow_scheduled_queue SET status = 'pending', processed_at = NULL, queued_at = datetime('now')
       WHERE status = 'failed'`,
    ).run();
    const retried = (result.meta as { changes?: number })?.changes ?? 0;
    c.executionCtx.waitUntil(runScheduledUnfollow(c.env));
    return c.json({ ok: true, retried, message: `${retried} failed items re-queued as pending. First batch draining now.` });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Follow queue status — counts by status so the UI can show drain progress
app.get("/api/auto-follow/queue-status", async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT status, count(*) as n FROM auto_follow_queue GROUP BY status`,
    ).all();
    const counts: Record<string, number> = {};
    for (const row of (rows.results as Array<{ status: string; n: number }>)) {
      counts[row.status] = Number(row.n);
    }
    const pending = counts["pending"] ?? 0;
    const processing = counts["processing"] ?? 0;
    const done = counts["done"] ?? 0;
    const failed = counts["failed"] ?? 0;
    const total = pending + processing + done + failed;
    const estimatedMinutesLeft = Math.ceil((pending + processing) / 40) * 3;
    return c.json({ ok: true, pending: pending + processing, done, failed, total, estimatedMinutesLeft });
  } catch (err) {
    return c.json({ ok: false, pending: 0, done: 0, failed: 0, total: 0, estimatedMinutesLeft: 0, error: err instanceof Error ? err.message : String(err) });
  }
});

// Clear completed follow queue entries (done / failed) to reset the progress bar
app.post("/api/auto-follow/queue-clear", async (c) => {
  try {
    const result = await c.env.DB.prepare(
      `DELETE FROM auto_follow_queue WHERE status IN ('done', 'failed')`,
    ).run();
    const deleted = (result.meta as { changes?: number })?.changes ?? 0;
    return c.json({ ok: true, deleted });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Manual trigger — indexes ALL feeds (bypasses stagger) + runs Jetstream pass
app.post("/api/admin/trigger-index", async (c) => {
  c.executionCtx.waitUntil(
    Promise.allSettled([
      runJetstreamIndexer(c.env)
        .then((r) => console.log(`[trigger-index] Jetstream: ${r.indexed} indexed from ${r.events} events`))
        .catch((err) => console.error("[trigger-index] Jetstream error:", err instanceof Error ? err.message : String(err))),
      runIndexer(c.env, { maxFeeds: Infinity })
        .then((results) => {
          const total = results.reduce((s, r) => s + r.indexed, 0);
          console.log(`[trigger-index] Search: ${total} posts across ${results.length} feeds`);
        })
        .catch((err) => console.error("[trigger-index] Search error:", err instanceof Error ? err.message : String(err))),
    ]),
  );
  return c.json({
    ok: true,
    message: "Full index started (Jetstream + all feeds) — counts update in ~30s",
  });
});

app.route("/api", feedsRoute);
app.route("/api", postsRoute);
app.route("/api", statsRoute);
app.route("/api", analyticsRoute);
app.route("/api", audienceRoute);
app.route("/api", composeRoute);
app.route("/api", notificationsRoute);
app.route("/api", cronSettingsRoute);
app.route("/api", syndicationRoute);
app.route("/api", followSettingsRoute);
app.route("/", xrpcRoute);

// ── Cron health endpoint ──────────────────────────────────────────────────────
// Exposes last cron tick time and scan-in-progress state so the dashboard can
// detect stalled crons (missed ticks) and surface a recovery warning to the user.
app.get("/api/admin/cron-health", async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT key, value FROM cron_settings WHERE key IN (
        'last_cron_tick','auto_unfollow_scan_cursor','auto_unfollow_last_run',
        'auto_unfollow_scan_pages_done','jetstream_cursor','jetstream_last_indexed',
        'jetstream_last_events','jetstream_last_run','jetstream_last_followers',
        'jetstream_do_last_ping'
      )`
    ).all<{ key: string; value: string }>();

    const kv: Record<string, string> = {};
    for (const r of rows.results) kv[r.key] = r.value;

    const lastTick = kv["last_cron_tick"] ?? null;
    const isHealthy = lastTick
      ? Date.now() - new Date(lastTick).getTime() < 6 * 60 * 1000
      : false;

    // Jetstream cursor is Unix microseconds — convert to ms for lag calculation
    const jetstreamCursorUs = kv["jetstream_cursor"] ? Number(kv["jetstream_cursor"]) : null;
    const jetstreamCursorMs = jetstreamCursorUs ? Math.round(jetstreamCursorUs / 1_000) : null;
    const jetstreamLagSeconds = jetstreamCursorMs
      ? Math.round((Date.now() - jetstreamCursorMs) / 1_000)
      : null;

    const doLastPing = kv["jetstream_do_last_ping"] ?? null;
    const doConnected = doLastPing
      ? Date.now() - new Date(doLastPing).getTime() < 10 * 60 * 1000
      : false;

    return c.json({
      ok: true,
      lastCronTick: lastTick,
      isHealthy,
      scanInProgress: (kv["auto_unfollow_scan_cursor"] ?? "") !== "",
      scanPagesDone: parseInt(kv["auto_unfollow_scan_pages_done"] ?? "0", 10) || 0,
      lastScanCompleted: kv["auto_unfollow_last_run"] ?? null,
      jetstream: {
        lastRun: kv["jetstream_last_run"] ?? null,
        lastIndexed: parseInt(kv["jetstream_last_indexed"] ?? "0", 10) || 0,
        lastEvents: parseInt(kv["jetstream_last_events"] ?? "0", 10) || 0,
        cursorMs: jetstreamCursorMs,
        lagSeconds: jetstreamLagSeconds,
        active: (kv["jetstream_last_run"] ?? "") !== "",
        lastFollowers: parseInt(kv["jetstream_last_followers"] ?? "0", 10) || 0,
        doLastPing,
        doConnected,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Scheduled handler removed — all cron jobs now live in the feedforge-cron
// worker (src/cron.ts / wrangler.cron.toml) so Smart Placement can be applied
// only to the write-heavy D1 work without anchoring the read path.
export default { fetch: app.fetch };
