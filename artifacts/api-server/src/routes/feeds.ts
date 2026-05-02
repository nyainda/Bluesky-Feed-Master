import { Router, type IRouter } from "express";
import { eq, sql, count } from "drizzle-orm";
import { db, feedsTable, keywordsTable, indexedPostsTable } from "@workspace/db";
import {
  CreateFeedBody,
  GetFeedParams,
  UpdateFeedParams,
  UpdateFeedBody,
  DeleteFeedParams,
  GetFeedKeywordsParams,
  AddFeedKeywordParams,
  AddFeedKeywordBody,
  DeleteFeedKeywordParams,
  GetFeedPostsParams,
  GetFeedPostsQueryParams,
  ListPostsQueryParams,
} from "@workspace/api-zod";
import { like, desc, and, lt } from "drizzle-orm";

const router: IRouter = Router();

async function getFeedWithCount(id: number) {
  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return null;

  const [{ postCount }] = await db
    .select({ postCount: count() })
    .from(indexedPostsTable)
    .where(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));

  return { ...feed, postCount };
}

async function getAllFeedsWithCounts() {
  const feeds = await db.select().from(feedsTable).orderBy(feedsTable.createdAt);
  return Promise.all(
    feeds.map(async (feed) => {
      const [{ postCount }] = await db
        .select({ postCount: count() })
        .from(indexedPostsTable)
        .where(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));
      return { ...feed, postCount };
    }),
  );
}

router.get("/feeds", async (req, res): Promise<void> => {
  const feeds = await getAllFeedsWithCounts();
  res.json(feeds);
});

router.post("/feeds", async (req, res): Promise<void> => {
  const parsed = CreateFeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [feed] = await db
    .insert(feedsTable)
    .values({
      recordName: parsed.data.recordName,
      displayName: parsed.data.displayName,
      description: parsed.data.description ?? null,
    })
    .returning();

  res.status(201).json({ ...feed, postCount: 0 });
});

router.get("/feeds/:id", async (req, res): Promise<void> => {
  const params = GetFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const feed = await getFeedWithCount(params.data.id);
  if (!feed) {
    res.status(404).json({ error: "Feed not found" });
    return;
  }

  res.json(feed);
});

router.patch("/feeds/:id", async (req, res): Promise<void> => {
  const params = UpdateFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateFeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof feedsTable.$inferInsert> = {};
  if (parsed.data.displayName != null) updates.displayName = parsed.data.displayName;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? null;
  if (parsed.data.isActive != null) updates.isActive = parsed.data.isActive;

  const [updated] = await db
    .update(feedsTable)
    .set(updates)
    .where(eq(feedsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Feed not found" });
    return;
  }

  const feed = await getFeedWithCount(updated.id);
  res.json(feed);
});

router.delete("/feeds/:id", async (req, res): Promise<void> => {
  const params = DeleteFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(feedsTable)
    .where(eq(feedsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Feed not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/feeds/:id/keywords", async (req, res): Promise<void> => {
  const params = GetFeedKeywordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const keywords = await db
    .select()
    .from(keywordsTable)
    .where(eq(keywordsTable.feedId, params.data.id))
    .orderBy(keywordsTable.createdAt);

  res.json(keywords);
});

router.post("/feeds/:id/keywords", async (req, res): Promise<void> => {
  const params = AddFeedKeywordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddFeedKeywordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, params.data.id));
  if (!feed) {
    res.status(404).json({ error: "Feed not found" });
    return;
  }

  const [keyword] = await db
    .insert(keywordsTable)
    .values({
      feedId: params.data.id,
      keyword: parsed.data.keyword.toLowerCase(),
    })
    .returning();

  res.status(201).json(keyword);
});

router.delete("/feeds/:id/keywords/:keywordId", async (req, res): Promise<void> => {
  const params = DeleteFeedKeywordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(keywordsTable)
    .where(
      and(
        eq(keywordsTable.id, params.data.keywordId),
        eq(keywordsTable.feedId, params.data.id),
      ),
    )
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Keyword not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/feeds/:id/posts", async (req, res): Promise<void> => {
  const params = GetFeedPostsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetFeedPostsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, params.data.id));
  if (!feed) {
    res.status(404).json({ error: "Feed not found" });
    return;
  }

  const limit = query.data.limit ?? 50;
  const cursor = query.data.cursor;

  const conditions = [like(indexedPostsTable.algoTags, `%${feed.recordName}%`)];
  if (cursor) {
    const [ts] = cursor.split("::");
    conditions.push(lt(indexedPostsTable.indexedAt, new Date(ts)));
  }

  const posts = await db
    .select()
    .from(indexedPostsTable)
    .where(and(...conditions))
    .orderBy(desc(indexedPostsTable.indexedAt))
    .limit(limit);

  const [{ total }] = await db
    .select({ total: count() })
    .from(indexedPostsTable)
    .where(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));

  let nextCursor: string | undefined;
  if (posts.length >= limit) {
    const last = posts[posts.length - 1];
    nextCursor = `${last.indexedAt.toISOString()}::${last.cid}`;
  }

  res.json({
    posts: posts.map((p) => ({ ...p, indexedAt: p.indexedAt.toISOString() })),
    cursor: nextCursor,
    total,
  });
});

router.get("/posts", async (req, res): Promise<void> => {
  const query = ListPostsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const limit = query.data.limit ?? 50;
  const cursor = query.data.cursor;
  const search = query.data.search;

  const conditions = [];
  if (cursor) {
    const [ts] = cursor.split("::");
    conditions.push(lt(indexedPostsTable.indexedAt, new Date(ts)));
  }
  if (search) {
    conditions.push(like(indexedPostsTable.text, `%${search}%`));
  }

  const posts = await db
    .select()
    .from(indexedPostsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(indexedPostsTable.indexedAt))
    .limit(limit);

  const [{ total }] = await db.select({ total: count() }).from(indexedPostsTable);

  let nextCursor: string | undefined;
  if (posts.length >= limit) {
    const last = posts[posts.length - 1];
    nextCursor = `${last.indexedAt.toISOString()}::${last.cid}`;
  }

  res.json({
    posts: posts.map((p) => ({ ...p, indexedAt: p.indexedAt.toISOString() })),
    cursor: nextCursor,
    total,
  });
});

export default router;
