import { Hono } from "hono";
import { count, sql, eq, like, and } from "drizzle-orm";
import { createDb, feedsTable, keywordsTable, indexedPostsTable } from "../db";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

route.get("/stats/7day", async (c) => {
  const db = createDb(c.env.DB);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db.all<{ day: string; count: number }>(sql`
    SELECT
      strftime('%Y-%m-%d', indexed_at) AS day,
      COUNT(*) AS count
    FROM indexed_posts
    WHERE indexed_at >= ${since7d}
    GROUP BY strftime('%Y-%m-%d', indexed_at)
    ORDER BY day ASC
  `);

  return c.json(rows);
});

route.get("/feeds/:id/keyword-stats", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return c.json({ error: "Feed not found" }, 404);

  const keywords = await db.select().from(keywordsTable).where(eq(keywordsTable.feedId, id));

  const stats = await Promise.all(
    keywords.map(async (kw) => {
      const [{ postCount }] = await db
        .select({ postCount: count() })
        .from(indexedPostsTable)
        .where(
          and(
            like(indexedPostsTable.algoTags, `%${feed.recordName}%`),
            like(indexedPostsTable.text, `%${kw.keyword}%`),
          ),
        );
      return { keyword: kw.keyword, postCount };
    }),
  );

  const total = stats.reduce((s, k) => s + k.postCount, 0);
  const result = stats
    .map((s) => ({
      ...s,
      percentage: total > 0 ? Math.round((s.postCount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.postCount - a.postCount);

  return c.json(result);
});

route.get("/feeds/:id/top-authors", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return c.json({ error: "Feed not found" }, 404);

  const rows = await db.all<{ did: string; post_count: number; latest_post_at: string }>(sql`
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

  return c.json(
    rows.map((r) => ({
      did: r.did,
      postCount: Number(r.post_count),
      latestPostAt: r.latest_post_at,
    })),
  );
});

route.get("/feeds/:id/hourly", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return c.json({ error: "Feed not found" }, 404);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const rows = await db.all<{ hour: string; count: number }>(sql`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', indexed_at) AS hour,
      COUNT(*) AS count
    FROM indexed_posts
    WHERE indexed_at >= ${since24h}
      AND algo_tags LIKE ${"%" + feed.recordName + "%"}
    GROUP BY strftime('%Y-%m-%dT%H:00:00', indexed_at)
    ORDER BY hour ASC
  `);

  return c.json(rows);
});

route.get("/bluesky/my-posts", async (c) => {
  const did = c.env.FEEDGEN_PUBLISHER_DID;
  if (!did) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const cursor = c.req.query("cursor");
    const limit = Math.min(parseInt(c.req.query("limit") || "30", 10), 50);

    const result = await agent.getAuthorFeed({ actor: did, limit, cursor, filter: "posts_no_replies" });

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
          hasImages: !!(embed?.images && embed.images.length > 0),
          langs: record.langs ?? [],
        };
      });

    const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
    const totalReposts = posts.reduce((s, p) => s + p.reposts, 0);
    const totalReplies = posts.reduce((s, p) => s + p.replies, 0);
    const totalQuotes = posts.reduce((s, p) => s + p.quotes, 0);

    return c.json({
      posts,
      cursor: result.data.cursor ?? null,
      stats: { totalLikes, totalReposts, totalReplies, totalQuotes, postCount: posts.length },
    });
  } catch (err) {
    console.error("Failed to fetch author posts:", err);
    return c.json({ error: "Failed to fetch posts" }, 500);
  }
});

route.get("/bluesky/best-time", async (c) => {
  const did = c.env.FEEDGEN_PUBLISHER_DID;
  if (!did) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });

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

    type HourBucket = { likes: number; reposts: number; replies: number; count: number; dayOfWeek: number };
    const byHour: Record<number, HourBucket> = {};
    for (let h = 0; h < 24; h++) byHour[h] = { likes: 0, reposts: 0, replies: 0, count: 0, dayOfWeek: 0 };
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
      return {
        hour,
        dayOfWeek: b.dayOfWeek,
        avgLikes: Math.round((b.likes / n) * 100) / 100,
        avgReposts: Math.round((b.reposts / n) * 100) / 100,
        avgReplies: Math.round((b.replies / n) * 100) / 100,
        postCount: b.count,
        avgEngagement: Math.round(((b.likes + b.reposts + b.replies) / n) * 100) / 100,
      };
    });

    const bestHour = hourly.reduce((best, slot) => slot.avgEngagement > best.avgEngagement ? slot : best, hourly[0]).hour;
    const bestDay = Object.entries(byDay).reduce((best, [day, d]) => {
      const avg = d.count > 0 ? d.totalEngagement / d.count : 0;
      const bestAvg = best[1].count > 0 ? best[1].totalEngagement / best[1].count : 0;
      return avg > bestAvg ? [day, d] : best;
    }, ["0", byDay[0]] as [string, DayBucket]);

    return c.json({ hourly, bestHour, bestDay: parseInt(bestDay[0]) });
  } catch (err) {
    console.error("getBestTimeToPost failed:", err);
    return c.json({ error: "Failed to compute best time to post" }, 500);
  }
});

route.get("/bluesky/hashtag-analysis", async (c) => {
  const did = c.env.FEEDGEN_PUBLISHER_DID;
  if (!did) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });

    const posts: { text: string; likes: number; reposts: number; replies: number; quotes: number }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const result = await agent.getAuthorFeed({ actor: did, limit: 50, cursor, filter: "posts_no_replies" });
      for (const item of result.data.feed) {
        const record = item.post.record as { text?: string };
        posts.push({
          text: record.text ?? "",
          likes: item.post.likeCount ?? 0,
          reposts: item.post.repostCount ?? 0,
          replies: item.post.replyCount ?? 0,
          quotes: item.post.quoteCount ?? 0,
        });
      }
      cursor = result.data.cursor;
      if (!cursor) break;
    }

    const hashtagRegex = /#([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]+)/g;
    type HashtagStats = {
      tag: string; postCount: number; totalLikes: number; totalReposts: number;
      totalReplies: number; totalEngagement: number; avgEngagement: number; avgLikes: number;
      topPost: { text: string; likes: number; reposts: number } | null;
    };
    const tagMap = new Map<string, HashtagStats>();

    for (const post of posts) {
      const matches = [...post.text.matchAll(hashtagRegex)];
      const engagement = post.likes + post.reposts + post.replies + post.quotes;
      const seenInPost = new Set<string>();
      for (const match of matches) {
        const tag = match[1].toLowerCase();
        if (seenInPost.has(tag)) continue;
        seenInPost.add(tag);
        if (!tagMap.has(tag)) {
          tagMap.set(tag, { tag, postCount: 0, totalLikes: 0, totalReposts: 0, totalReplies: 0, totalEngagement: 0, avgEngagement: 0, avgLikes: 0, topPost: null });
        }
        const s = tagMap.get(tag)!;
        s.postCount++;
        s.totalLikes += post.likes;
        s.totalReposts += post.reposts;
        s.totalReplies += post.replies;
        s.totalEngagement += engagement;
        if (!s.topPost || post.likes > s.topPost.likes) {
          s.topPost = { text: post.text.slice(0, 140), likes: post.likes, reposts: post.reposts };
        }
      }
    }

    const hashtags = [...tagMap.values()].map(s => ({
      ...s,
      avgEngagement: Math.round((s.totalEngagement / s.postCount) * 100) / 100,
      avgLikes: Math.round((s.totalLikes / s.postCount) * 100) / 100,
    })).sort((a, b) => b.avgEngagement - a.avgEngagement);

    const postsWithHashtags = posts.filter(p => /#[a-zA-Z]/.test(p.text)).length;
    return c.json({ hashtags, totalPostsAnalyzed: posts.length, postsWithHashtags });
  } catch (err) {
    console.error("getHashtagAnalysis failed:", err);
    return c.json({ error: "Failed to compute hashtag analysis" }, 500);
  }
});

route.get("/bluesky/profile", async (c) => {
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  if (!publisherDid) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const profile = await agent.getProfile({ actor: publisherDid });
    const p = profile.data;
    return c.json({
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
    console.error("Failed to fetch Bluesky profile:", err);
    return c.json({ error: "Failed to fetch profile" }, 500);
  }
});

route.get("/bluesky/feed-info/:recordName", async (c) => {
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  const recordName = c.req.param("recordName");
  if (!publisherDid) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const feedUri = `at://${publisherDid}/app.bsky.feed.generator/${recordName}`;
    const info = await agent.app.bsky.feed.getFeedGenerator({ feed: feedUri });
    const v = info.data.view;
    return c.json({
      uri: v.uri,
      cid: v.cid,
      displayName: v.displayName,
      description: v.description ?? null,
      likeCount: v.likeCount ?? 0,
      viewerLiked: v.viewer?.like ?? null,
    });
  } catch (err) {
    console.error("Failed to fetch feed info:", err);
    return c.json({ error: "Feed not found on Bluesky or not published yet" }, 404);
  }
});

route.get("/feeds/:id/keyword-suggestions", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return c.json({ error: "Feed not found" }, 404);

  const existingKeywords = await db.select().from(keywordsTable).where(eq(keywordsTable.feedId, id));
  const existingSet = new Set(existingKeywords.map((k) => k.keyword.toLowerCase()));

  const posts = await db.all<{ text: string; likes: number; reposts: number }>(sql`
    SELECT text, likes, reposts
    FROM indexed_posts
    WHERE algo_tags LIKE ${"%" + feed.recordName + "%"}
    ORDER BY (likes + reposts * 2) DESC
    LIMIT 2000
  `);

  if (posts.length === 0) return c.json([]);

  const STOP = new Set([
    "the","a","an","and","or","but","in","on","at","to","for","of","with","is","are","was","were",
    "be","been","being","have","has","had","do","does","did","will","would","could","should",
    "may","might","shall","this","that","these","those","i","you","he","she","it","we","they",
    "my","your","his","her","its","our","their","me","him","us","them","what","which","who","how",
    "when","where","why","all","any","both","each","few","more","most","other","some","such","no",
    "not","only","own","same","so","than","too","very","just","can","now","then","here","there",
    "if","as","by","from","up","about","into","through","after","before","out","over","under",
    "once","https","http","bluesky","bsky","com","www","org","net","app","via","cc","re","rt",
    "get","go","got","new","like","love","good","great","well","also","even","still","much",
    "many","want","need","know","think","make","see","use","using","used","made","take","look",
    "say","said","way","time","day","year","people","work","one","two","three","post","thread",
    "reply","check","share","read","feel","really","actually","always","never","every","since",
  ]);

  const wordStats = new Map<string, { count: number; totalEngagement: number }>();

  for (const post of posts) {
    const engagement = (post.likes ?? 0) + (post.reposts ?? 0) * 2;
    const words = post.text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 4 &&
          w.length <= 30 &&
          !STOP.has(w) &&
          !existingSet.has(w) &&
          !/^\d+$/.test(w),
      );

    const seenInPost = new Set<string>();
    for (const word of words) {
      if (seenInPost.has(word)) continue;
      seenInPost.add(word);
      const s = wordStats.get(word) ?? { count: 0, totalEngagement: 0 };
      s.count++;
      s.totalEngagement += engagement;
      wordStats.set(word, s);
    }
  }

  const suggestions = [...wordStats.entries()]
    .filter(([, s]) => s.count >= 2)
    .map(([word, s]) => ({
      word,
      count: s.count,
      avgEngagement: Math.round((s.totalEngagement / s.count) * 10) / 10,
      score: Math.round(s.count * (1 + s.totalEngagement / s.count) * 10) / 10,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return c.json(suggestions);
});

export default route;
