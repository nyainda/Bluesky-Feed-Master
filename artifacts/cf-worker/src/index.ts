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
import { runIndexer, runCleanup } from "./lib/indexer";
import { runJetstreamIndexer } from "./lib/jetstream";
import { runScheduler } from "./lib/scheduler";
import { runAuthorScoring } from "./lib/author-scoring";
import { precomputeFeedRankings } from "./lib/feed-ranking";
import { runAutoUnfollow } from "./lib/auto-unfollow";
import { runAmplifier } from "./lib/amplifier";
import { runScheduledUnfollow, ensureScheduledUnfollowTable } from "./lib/scheduled-unfollow";
import { runAutoFollow } from "./lib/auto-follow";
import { runScheduledFollow, runFollowBackCheck } from "./lib/scheduled-follow";

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
    const { eq, sql: drizzleSql, like, count: cnt } = await import("drizzle-orm");

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
            algoTags: drizzleSql`CASE WHEN algo_tags LIKE ${"%" + algoTag + "%"} THEN algo_tags ELSE algo_tags || ',' || ${algoTag} END`,
            likes: post.likeCount ?? 0,
          },
        });
        insertResults.push(`OK: ${post.uri.slice(-16)}`);
      } catch (e) {
        insertResults.push(`ERR: ${post.uri.slice(-16)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const [{ count: postCount }] = await db.select({ count: cnt() }).from(ipt).where(like(ipt.algoTags, `%${algoTag}%`));

    return c.json({ feed: feed.recordName, keyword, postsFound: posts.length, insertResults, postCountAfter: postCount });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
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
        'jetstream_last_events','jetstream_last_run'
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
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      // Record this tick for health-check monitoring
      await env.DB.prepare(
        "INSERT INTO cron_settings (key, value) VALUES ('last_cron_tick', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')"
      ).run().catch(() => {});

      // 2am daily cron — cleanup only
      if (event.cron === "0 2 * * *") {
        await runCleanup(env);
        return;
      }
      // Every 3 minutes — drain jobs run first, then indexing, then heavy scans

      // 1. Drain queues FIRST — guaranteed to run every tick
      await runScheduledUnfollow(env);  // 40 unfollows/tick
      await runScheduledFollow(env);    // 10 follows/tick

      // 2. Jetstream — primary real-time indexer (firehose, no search rate limits)
      await runJetstreamIndexer(env);

      // 3. Scheduler + search backfill (staggered: 1 feed/tick round-robin)
      await runScheduler(env);
      await runIndexer(env);            // supplemental search-API pass, 1 feed/tick

      // 4. Scoring + ranking
      await runAuthorScoring(env);
      await precomputeFeedRankings(env);

      // 5. Auto-follow discovery + follow-back check
      await runAutoFollow(env);
      await runFollowBackCheck(env);

      // 6. Auto-unfollow scan (500 following/tick — queues for step 1 above)
      await runAutoUnfollow(env);
      await runAmplifier(env);
    })());
  },
};
