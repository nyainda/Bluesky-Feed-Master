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

export default route;
