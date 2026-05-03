import { Router, type IRouter } from "express";
import { count, sum, avg, gte, sql, desc, and, like, eq, lt, isNotNull } from "drizzle-orm";
import { db, feedsTable, indexedPostsTable, keywordsTable } from "@workspace/db";
import { AtpAgent } from "@atproto/api";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/stats/7day", async (_req, res): Promise<void> => {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT
      date_trunc('day', indexed_at) AS day,
      COUNT(*) AS count
    FROM indexed_posts
    WHERE indexed_at >= ${since7d}
    GROUP BY date_trunc('day', indexed_at)
    ORDER BY day ASC
  `);

  const rows = result.rows as { day: Date | string; count: string }[];
  res.json(rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString() : String(r.day),
    count: Number(r.count),
  })));
});

router.get("/feeds/:id/keyword-stats", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid feed ID" }); return; }

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) { res.status(404).json({ error: "Feed not found" }); return; }

  const keywords = await db.select().from(keywordsTable).where(eq(keywordsTable.feedId, id));

  const stats = await Promise.all(
    keywords.map(async (kw) => {
      const [{ postCount }] = await db
        .select({ postCount: count() })
        .from(indexedPostsTable)
        .where(and(
          like(indexedPostsTable.algoTags, `%${feed.recordName}%`),
          like(indexedPostsTable.text, `%${kw.keyword}%`),
        ));
      return { keyword: kw.keyword, postCount };
    }),
  );

  const total = stats.reduce((s, k) => s + k.postCount, 0);
  const result = stats
    .map((s) => ({ ...s, percentage: total > 0 ? Math.round((s.postCount / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.postCount - a.postCount);

  res.json(result);
});

router.get("/feeds/:id/top-authors", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid feed ID" }); return; }

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) { res.status(404).json({ error: "Feed not found" }); return; }

  const result = await db.execute(sql`
    SELECT
      author AS did,
      COUNT(*) AS post_count,
      MAX(indexed_at) AS latest_post_at
    FROM indexed_posts
    WHERE algo_tags LIKE ${"%" + feed.recordName + "%"}
    GROUP BY author
    ORDER BY post_count DESC
    LIMIT 20
  `);

  const rows = result.rows as { did: string; post_count: string; latest_post_at: Date | string }[];
  res.json(rows.map((r) => ({
    did: r.did,
    postCount: Number(r.post_count),
    latestPostAt: r.latest_post_at instanceof Date ? r.latest_post_at.toISOString() : String(r.latest_post_at),
  })));
});

router.get("/feeds/:id/hourly", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid feed ID" }); return; }

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) { res.status(404).json({ error: "Feed not found" }); return; }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT
      date_trunc('hour', indexed_at) AS hour,
      COUNT(*) AS count
    FROM indexed_posts
    WHERE indexed_at >= ${since24h}
      AND algo_tags LIKE ${"%" + feed.recordName + "%"}
    GROUP BY date_trunc('hour', indexed_at)
    ORDER BY hour ASC
  `);

  const rows = result.rows as { hour: Date | string; count: string }[];
  res.json(rows.map((r) => ({
    hour: r.hour instanceof Date ? r.hour.toISOString() : String(r.hour),
    count: Number(r.count),
  })));
});

router.get("/stats/top-posts", async (req, res): Promise<void> => {
  const feedId = req.query.feedId ? parseInt(req.query.feedId as string) : null;
  const limit = Math.min(parseInt((req.query.limit as string) || "20"), 50);
  const sortBy = (req.query.sortBy as string) || "total";

  try {
    const conditions = [];

    if (feedId && !isNaN(feedId)) {
      const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, feedId));
      if (!feed) { res.status(404).json({ error: "Feed not found" }); return; }
      conditions.push(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));
    }

    // Only return posts that have had engagement synced (so we show meaningful data)
    // But also include unsynced posts sorted by time if nothing is synced
    const orderCol =
      sortBy === "likes" ? desc(indexedPostsTable.likes) :
      sortBy === "reposts" ? desc(indexedPostsTable.reposts) :
      sortBy === "replies" ? desc(indexedPostsTable.replies) :
      desc(sql`${indexedPostsTable.likes} + ${indexedPostsTable.reposts} + ${indexedPostsTable.replies} + ${indexedPostsTable.quotes}`);

    const posts = await db
      .select()
      .from(indexedPostsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderCol)
      .limit(limit);

    const result = posts.map(p => ({
      id: p.id,
      uri: p.uri,
      cid: p.cid,
      author: p.author,
      text: p.text,
      algoTags: p.algoTags,
      indexedAt: p.indexedAt.toISOString(),
      likes: p.likes,
      reposts: p.reposts,
      replies: p.replies,
      quotes: p.quotes,
      totalEngagement: p.likes + p.reposts + p.replies + p.quotes,
      engagementSyncedAt: p.engagementSyncedAt ? p.engagementSyncedAt.toISOString() : null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "getTopPosts failed");
    res.status(500).json({ error: "Failed to fetch top posts" });
  }
});

router.get("/stats/engagement-overview", async (req, res): Promise<void> => {
  const feedId = req.query.feedId ? parseInt(req.query.feedId as string) : null;

  try {
    const conditions = [];

    if (feedId && !isNaN(feedId)) {
      const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, feedId));
      if (!feed) { res.status(404).json({ error: "Feed not found" }); return; }
      conditions.push(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [overview] = await db
      .select({
        totalPosts: count(),
        syncedPosts: count(indexedPostsTable.engagementSyncedAt),
        totalLikes: sum(indexedPostsTable.likes),
        totalReposts: sum(indexedPostsTable.reposts),
        totalReplies: sum(indexedPostsTable.replies),
        totalQuotes: sum(indexedPostsTable.quotes),
      })
      .from(indexedPostsTable)
      .where(where);

    const totalLikes = Number(overview.totalLikes ?? 0);
    const totalReposts = Number(overview.totalReposts ?? 0);
    const totalReplies = Number(overview.totalReplies ?? 0);
    const totalQuotes = Number(overview.totalQuotes ?? 0);
    const totalEngagement = totalLikes + totalReposts + totalReplies + totalQuotes;
    const totalPosts = overview.totalPosts;
    const syncedPosts = overview.syncedPosts;
    const avgLikesPerPost = syncedPosts > 0 ? Math.round((totalLikes / syncedPosts) * 100) / 100 : 0;

    // Top post by total engagement
    const [topPost] = await db
      .select({ uri: indexedPostsTable.uri })
      .from(indexedPostsTable)
      .where(where)
      .orderBy(desc(sql`${indexedPostsTable.likes} + ${indexedPostsTable.reposts} + ${indexedPostsTable.replies} + ${indexedPostsTable.quotes}`))
      .limit(1);

    res.json({
      totalPosts,
      syncedPosts,
      totalLikes,
      totalReposts,
      totalReplies,
      totalQuotes,
      totalEngagement,
      avgLikesPerPost,
      topPostUri: topPost?.uri ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "getEngagementOverview failed");
    res.status(500).json({ error: "Failed to fetch engagement overview" });
  }
});

router.get("/bluesky/my-posts", async (req, res): Promise<void> => {
  const did = process.env.FEEDGEN_PUBLISHER_DID;
  if (!did) {
    res.status(404).json({ error: "FEEDGEN_PUBLISHER_DID not configured" });
    return;
  }

  try {
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || "30"), 50);

    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const result = await agent.getAuthorFeed({
      actor: did,
      limit,
      cursor,
      filter: "posts_no_replies",
    });

    const seen = new Set<string>();
    const posts = result.data.feed
      .filter((item) => {
        if (seen.has(item.post.uri)) return false;
        seen.add(item.post.uri);
        return true;
      })
      .map((item) => {
        const p = item.post;
        const record = p.record as { text?: string; createdAt?: string; langs?: string[] };
        const embed = p.embed as { $type?: string; images?: unknown[] } | undefined;
        return {
          uri: p.uri,
          cid: p.cid,
          text: record.text ?? "",
          createdAt: record.createdAt ?? p.indexedAt,
          indexedAt: p.indexedAt,
          likes: p.likeCount ?? 0,
          reposts: p.repostCount ?? 0,
          replies: p.replyCount ?? 0,
          quotes: p.quoteCount ?? 0,
          hasImages: !!(embed && embed.images && embed.images.length > 0),
          langs: record.langs ?? [],
        };
      });

    const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
    const totalReposts = posts.reduce((s, p) => s + p.reposts, 0);
    const totalReplies = posts.reduce((s, p) => s + p.replies, 0);
    const totalQuotes = posts.reduce((s, p) => s + p.quotes, 0);

    res.json({
      posts,
      cursor: result.data.cursor ?? null,
      stats: { totalLikes, totalReposts, totalReplies, totalQuotes, postCount: posts.length },
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch author posts");
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

router.get("/bluesky/profile", async (_req, res): Promise<void> => {
  const publisherDid = process.env.FEEDGEN_PUBLISHER_DID;
  if (!publisherDid) {
    res.status(404).json({ error: "FEEDGEN_PUBLISHER_DID not configured" });
    return;
  }

  try {
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const profile = await agent.getProfile({ actor: publisherDid });
    const p = profile.data;
    res.json({
      did: p.did,
      handle: p.handle,
      displayName: p.displayName ?? null,
      avatar: p.avatar ?? null,
      description: p.description ?? null,
      followersCount: p.followersCount ?? 0,
      followsCount: p.followsCount ?? 0,
      postsCount: p.postsCount ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch Bluesky profile");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

router.get("/bluesky/feed-info/:recordName", async (req, res): Promise<void> => {
  const publisherDid = process.env.FEEDGEN_PUBLISHER_DID;
  const { recordName } = req.params;

  if (!publisherDid) {
    res.status(404).json({ error: "FEEDGEN_PUBLISHER_DID not configured" });
    return;
  }

  try {
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const feedUri = `at://${publisherDid}/app.bsky.feed.generator/${recordName}`;
    const info = await agent.app.bsky.feed.getFeedGenerator({ feed: feedUri });
    const v = info.data.view;
    res.json({
      uri: v.uri,
      cid: v.cid,
      displayName: v.displayName,
      description: v.description ?? null,
      likeCount: v.likeCount ?? 0,
      viewerLiked: v.viewer?.like ?? null,
    });
  } catch (err) {
    logger.error({ err, recordName }, "Failed to fetch Bluesky feed info");
    res.status(404).json({ error: "Feed not found on Bluesky or not published yet" });
  }
});

// GET /api/bluesky/best-time
// Fetches up to 100 recent posts from Bluesky and aggregates engagement by hour+dayOfWeek
router.get("/bluesky/best-time", async (req, res): Promise<void> => {
  const did = process.env.FEEDGEN_PUBLISHER_DID;
  if (!did) { res.status(404).json({ error: "FEEDGEN_PUBLISHER_DID not configured" }); return; }

  try {
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });

    // Fetch up to 100 posts across two pages
    const posts: { createdAt: string; likes: number; reposts: number; replies: number }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 2; page++) {
      const result = await agent.getAuthorFeed({ actor: did, limit: 50, cursor, filter: "posts_no_replies" });
      for (const item of result.data.feed) {
        const record = item.post.record as { createdAt?: string };
        posts.push({
          createdAt: record.createdAt ?? item.post.indexedAt,
          likes: item.post.likeCount ?? 0,
          reposts: item.post.repostCount ?? 0,
          replies: item.post.replyCount ?? 0,
        });
      }
      cursor = result.data.cursor;
      if (!cursor) break;
    }

    // Aggregate by hour (0-23) across all days — simpler and more actionable
    type HourBucket = { likes: number; reposts: number; replies: number; count: number; dayOfWeek: number };
    const byHour: Record<number, HourBucket> = {};
    for (let h = 0; h < 24; h++) byHour[h] = { likes: 0, reposts: 0, replies: 0, count: 0, dayOfWeek: 0 };

    // Also track best day
    type DayBucket = { totalEngagement: number; count: number };
    const byDay: Record<number, DayBucket> = {};
    for (let d = 0; d < 7; d++) byDay[d] = { totalEngagement: 0, count: 0 };

    for (const p of posts) {
      const date = new Date(p.createdAt);
      const hour = date.getUTCHours();
      const day = date.getUTCDay();
      byHour[hour].likes += p.likes;
      byHour[hour].reposts += p.reposts;
      byHour[hour].replies += p.replies;
      byHour[hour].count++;
      byHour[hour].dayOfWeek = day;
      byDay[day].totalEngagement += p.likes + p.reposts + p.replies;
      byDay[day].count++;
    }

    const hourly = Array.from({ length: 24 }, (_, hour) => {
      const b = byHour[hour];
      const n = b.count || 1;
      const avgEngagement = (b.likes + b.reposts + b.replies) / n;
      return {
        hour,
        dayOfWeek: b.dayOfWeek,
        avgLikes: Math.round((b.likes / n) * 100) / 100,
        avgReposts: Math.round((b.reposts / n) * 100) / 100,
        avgReplies: Math.round((b.replies / n) * 100) / 100,
        postCount: b.count,
        avgEngagement: Math.round(avgEngagement * 100) / 100,
      };
    });

    const bestHour = hourly.reduce((best, slot) => slot.avgEngagement > best.avgEngagement ? slot : best, hourly[0]).hour;
    const bestDay = Object.entries(byDay).reduce((best, [day, d]) => {
      const avg = d.count > 0 ? d.totalEngagement / d.count : 0;
      const bestAvg = best[1].count > 0 ? best[1].totalEngagement / best[1].count : 0;
      return avg > bestAvg ? [day, d] : best;
    }, ["0", byDay[0]] as [string, DayBucket]);

    res.json({ hourly, bestHour, bestDay: parseInt(bestDay[0]) });
  } catch (err) {
    req.log.error({ err }, "getBestTimeToPost failed");
    res.status(500).json({ error: "Failed to compute best time to post" });
  }
});

export default router;
