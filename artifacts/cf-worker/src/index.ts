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
import { runIndexer, runCleanup } from "./lib/indexer";
import { runScheduler } from "./lib/scheduler";
import { runAuthorScoring } from "./lib/author-scoring";
import { precomputeFeedRankings } from "./lib/feed-ranking";

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

app.route("/api", feedsRoute);
app.route("/api", postsRoute);
app.route("/api", statsRoute);
app.route("/api", analyticsRoute);
app.route("/api", audienceRoute);
app.route("/api", composeRoute);
app.route("/api", notificationsRoute);
app.route("/", xrpcRoute);

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      // 2am daily cron — cleanup only
      if (event.cron === "0 2 * * *") {
        await runCleanup(env);
        return;
      }
      // Every 3 minutes — index + score + rank
      await Promise.all([runIndexer(env), runScheduler(env)]);
      await runAuthorScoring(env);
      await precomputeFeedRankings(env);
    })());
  },
};
