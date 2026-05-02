import { Router, type IRouter } from "express";
import { count, gte, sql } from "drizzle-orm";
import { db, feedsTable, indexedPostsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { firehoseState } from "../lib/firehose";

const router: IRouter = Router();

router.get("/stats/overview", async (_req, res): Promise<void> => {
  const [{ totalFeeds }] = await db.select({ totalFeeds: count() }).from(feedsTable);
  const [{ activeFeeds }] = await db
    .select({ activeFeeds: count() })
    .from(feedsTable)
    .where(eq(feedsTable.isActive, true));
  const [{ totalPosts }] = await db.select({ totalPosts: count() }).from(indexedPostsTable);

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since1h = new Date(now.getTime() - 60 * 60 * 1000);

  const [{ postsLast24h }] = await db
    .select({ postsLast24h: count() })
    .from(indexedPostsTable)
    .where(gte(indexedPostsTable.indexedAt, since24h));

  const [{ postsLast1h }] = await db
    .select({ postsLast1h: count() })
    .from(indexedPostsTable)
    .where(gte(indexedPostsTable.indexedAt, since1h));

  res.json({
    totalFeeds,
    activeFeeds,
    totalPosts,
    postsLast24h,
    postsLast1h,
    firehoseConnected: firehoseState.connected,
    uptime: process.uptime(),
  });
});

router.get("/stats/firehose", (_req, res): void => {
  res.json({
    connected: firehoseState.connected,
    endpoint: firehoseState.endpoint,
    reconnectCount: firehoseState.reconnectCount,
    lastEventAt: firehoseState.lastEventAt,
    postsIndexedTotal: firehoseState.postsIndexedTotal,
  });
});

router.get("/stats/recent-activity", async (_req, res): Promise<void> => {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT
      date_trunc('hour', indexed_at) AS hour,
      COUNT(*) AS count
    FROM indexed_posts
    WHERE indexed_at >= ${since24h}
    GROUP BY date_trunc('hour', indexed_at)
    ORDER BY hour ASC
  `);

  const rows = result.rows as { hour: Date | string; count: string }[];
  const activity = rows.map((row) => ({
    hour: row.hour instanceof Date ? row.hour.toISOString() : String(row.hour),
    count: Number(row.count),
  }));

  res.json(activity);
});

router.get("/stats/top-feeds", async (_req, res): Promise<void> => {
  const feeds = await db.select().from(feedsTable);

  const ranked = await Promise.all(
    feeds.map(async (feed) => {
      const [{ postCount }] = await db
        .select({ postCount: count() })
        .from(indexedPostsTable)
        .where(sql`algo_tags LIKE ${"%" + feed.recordName + "%"}`);
      return {
        feedId: feed.id,
        recordName: feed.recordName,
        displayName: feed.displayName,
        postCount,
      };
    }),
  );

  ranked.sort((a, b) => b.postCount - a.postCount);
  res.json(ranked);
});

export default router;
