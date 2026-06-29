import { Hono } from "hono";
import { desc, and, lt, like, count } from "drizzle-orm";
import { createDb, indexedPostsTable } from "../db";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

route.get("/posts", async (c) => {
  const db = createDb(c.env.DB);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const cursor = c.req.query("cursor");
  const search = c.req.query("search");

  const conditions = [];
  if (cursor) {
    const [ts] = cursor.split("::");
    conditions.push(lt(indexedPostsTable.indexedAt, ts));
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
    nextCursor = `${last.indexedAt}::${last.cid}`;
  }

  return c.json({ posts, cursor: nextCursor, total });
});

export default route;
