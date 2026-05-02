import { Router, type IRouter } from "express";
import { count, gte, sql, desc, and, like, eq, lt } from "drizzle-orm";
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

export default router;
