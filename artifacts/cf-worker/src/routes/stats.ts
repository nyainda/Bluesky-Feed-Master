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

route.get("/stats/top-posts", async (c) => {
  const db = createDb(c.env.DB);
  const feedId = c.req.query("feedId") ? parseInt(c.req.query("feedId")!, 10) : null;
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
  const sortBy = c.req.query("sortBy") || "total";

  try {
    const conditions: ReturnType<typeof like>[] = [];
    if (feedId && !isNaN(feedId)) {
      const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, feedId));
      if (!feed) return c.json({ error: "Feed not found" }, 404);
      conditions.push(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));
    }

    const orderCol =
      sortBy === "likes" ? sql`likes DESC` :
      sortBy === "reposts" ? sql`reposts DESC` :
      sortBy === "replies" ? sql`replies DESC` :
      sql`(likes + reposts + replies + quotes) DESC`;

    const where = conditions.length > 0
      ? `AND algo_tags LIKE '%${(await db.select().from(feedsTable).where(eq(feedsTable.id, feedId!)).limit(1))[0]?.recordName}%'`
      : "";

    const posts = await db.all<{
      id: number; uri: string; cid: string; author: string; text: string;
      algo_tags: string; indexed_at: string; likes: number; reposts: number;
      replies: number; quotes: number; engagement_synced_at: string | null;
    }>(sql`
      SELECT id, uri, cid, author, text, algo_tags, indexed_at, likes, reposts, replies, quotes, engagement_synced_at
      FROM indexed_posts
      ${conditions.length > 0 ? sql`WHERE algo_tags LIKE ${"%" + (await db.select({ r: feedsTable.recordName }).from(feedsTable).where(eq(feedsTable.id, feedId!)).limit(1))[0]?.r + "%"}` : sql``}
      ORDER BY ${orderCol}
      LIMIT ${limit}
    `);

    return c.json(posts.map(p => ({
      id: p.id,
      uri: p.uri,
      cid: p.cid,
      author: p.author,
      text: p.text,
      algoTags: p.algo_tags,
      indexedAt: p.indexed_at,
      likes: p.likes,
      reposts: p.reposts,
      replies: p.replies,
      quotes: p.quotes,
      totalEngagement: p.likes + p.reposts + p.replies + p.quotes,
      engagementSyncedAt: p.engagement_synced_at,
    })));
  } catch (err) {
    console.error("getTopPosts failed:", err);
    return c.json({ error: "Failed to fetch top posts" }, 500);
  }
});

route.get("/stats/engagement-overview", async (c) => {
  const db = createDb(c.env.DB);
  const feedId = c.req.query("feedId") ? parseInt(c.req.query("feedId")!, 10) : null;

  try {
    let whereClause = sql`1=1`;
    if (feedId && !isNaN(feedId)) {
      const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, feedId));
      if (!feed) return c.json({ error: "Feed not found" }, 404);
      whereClause = sql`algo_tags LIKE ${"%" + feed.recordName + "%"}`;
    }

    const [overview] = await db.all<{
      total_posts: number; synced_posts: number; total_likes: number;
      total_reposts: number; total_replies: number; total_quotes: number;
    }>(sql`
      SELECT
        COUNT(*) as total_posts,
        COUNT(engagement_synced_at) as synced_posts,
        COALESCE(SUM(likes), 0) as total_likes,
        COALESCE(SUM(reposts), 0) as total_reposts,
        COALESCE(SUM(replies), 0) as total_replies,
        COALESCE(SUM(quotes), 0) as total_quotes
      FROM indexed_posts
      WHERE ${whereClause}
    `);

    const totalLikes = Number(overview.total_likes ?? 0);
    const totalReposts = Number(overview.total_reposts ?? 0);
    const totalReplies = Number(overview.total_replies ?? 0);
    const totalQuotes = Number(overview.total_quotes ?? 0);
    const totalEngagement = totalLikes + totalReposts + totalReplies + totalQuotes;
    const totalPosts = Number(overview.total_posts ?? 0);
    const syncedPosts = Number(overview.synced_posts ?? 0);
    const avgLikesPerPost = syncedPosts > 0 ? Math.round((totalLikes / syncedPosts) * 100) / 100 : 0;

    const [topPost] = await db.all<{ uri: string }>(sql`
      SELECT uri FROM indexed_posts
      WHERE ${whereClause}
      ORDER BY (likes + reposts + replies + quotes) DESC
      LIMIT 1
    `);

    return c.json({
      totalPosts, syncedPosts, totalLikes, totalReposts, totalReplies, totalQuotes,
      totalEngagement, avgLikesPerPost, topPostUri: topPost?.uri ?? null,
    });
  } catch (err) {
    console.error("getEngagementOverview failed:", err);
    return c.json({ error: "Failed to fetch engagement overview" }, 500);
  }
});

export default route;
