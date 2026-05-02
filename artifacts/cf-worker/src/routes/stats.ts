import { Hono } from "hono";
import { count, gte, sql, eq, like } from "drizzle-orm";
import { createDb, feedsTable, indexedPostsTable } from "../db";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

route.get("/stats/overview", async (c) => {
  const db = createDb(c.env.DB);

  const [{ totalFeeds }] = await db.select({ totalFeeds: count() }).from(feedsTable);
  const [{ activeFeeds }] = await db
    .select({ activeFeeds: count() })
    .from(feedsTable)
    .where(eq(feedsTable.isActive, true));
  const [{ totalPosts }] = await db.select({ totalPosts: count() }).from(indexedPostsTable);

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const [{ postsLast24h }] = await db
    .select({ postsLast24h: count() })
    .from(indexedPostsTable)
    .where(gte(indexedPostsTable.indexedAt, since24h));

  const [{ postsLast1h }] = await db
    .select({ postsLast1h: count() })
    .from(indexedPostsTable)
    .where(gte(indexedPostsTable.indexedAt, since1h));

  return c.json({
    totalFeeds,
    activeFeeds,
    totalPosts,
    postsLast24h,
    postsLast1h,
    firehoseConnected: false,
    indexerMode: "cron",
    cronSchedule: "*/3 * * * *",
  });
});

route.get("/stats/firehose", (c) =>
  c.json({
    connected: false,
    indexerMode: "cron",
    cronSchedule: "*/3 * * * *",
    message: "Running on Cloudflare Workers — posts indexed via cron every 3 minutes",
  }),
);

route.get("/stats/recent-activity", async (c) => {
  const db = createDb(c.env.DB);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const rows = await db.all<{ hour: string; count: number }>(sql`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', indexed_at) AS hour,
      COUNT(*) AS count
    FROM indexed_posts
    WHERE indexed_at >= ${since24h}
    GROUP BY strftime('%Y-%m-%dT%H:00:00', indexed_at)
    ORDER BY hour ASC
  `);

  return c.json(rows);
});

route.get("/stats/top-feeds", async (c) => {
  const db = createDb(c.env.DB);
  const feeds = await db.select().from(feedsTable);

  const ranked = await Promise.all(
    feeds.map(async (feed) => {
      const [{ postCount }] = await db
        .select({ postCount: count() })
        .from(indexedPostsTable)
        .where(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));
      return {
        feedId: feed.id,
        recordName: feed.recordName,
        displayName: feed.displayName,
        postCount,
      };
    }),
  );

  ranked.sort((a, b) => b.postCount - a.postCount);
  return c.json(ranked);
});

export default route;
