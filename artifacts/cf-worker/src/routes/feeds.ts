import { Hono } from "hono";
import { eq, desc, and, lt, count, sql } from "drizzle-orm";
import { createDb, feedsTable, keywordsTable, indexedPostsTable, feedRankedPostsTable } from "../db";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

async function getFeedWithCount(db: ReturnType<typeof createDb>, id: number) {
  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return null;
  const tagExpr = sql`instr(',' || ${indexedPostsTable.algoTags} || ',', ',' || ${feed.recordName} || ',') > 0`;
  const [{ postCount }] = await db
    .select({ postCount: count() })
    .from(indexedPostsTable)
    .where(tagExpr);
  const [latestPost] = await db
    .select({ indexedAt: indexedPostsTable.indexedAt })
    .from(indexedPostsTable)
    .where(tagExpr)
    .orderBy(desc(indexedPostsTable.indexedAt))
    .limit(1);
  return { ...feed, postCount, lastIndexedAt: latestPost?.indexedAt ?? null };
}

route.get("/feeds", async (c) => {
  const db = createDb(c.env.DB);
  const feeds = await db.select().from(feedsTable).orderBy(feedsTable.createdAt);
  const result = await Promise.all(
    feeds.map(async (feed) => {
      const tagExpr = sql`instr(',' || ${indexedPostsTable.algoTags} || ',', ',' || ${feed.recordName} || ',') > 0`;
      const [{ postCount }] = await db
        .select({ postCount: count() })
        .from(indexedPostsTable)
        .where(tagExpr);
      const [latestPost] = await db
        .select({ indexedAt: indexedPostsTable.indexedAt })
        .from(indexedPostsTable)
        .where(tagExpr)
        .orderBy(desc(indexedPostsTable.indexedAt))
        .limit(1);
      return { ...feed, postCount, lastIndexedAt: latestPost?.indexedAt ?? null };
    }),
  );
  return c.json(result);
});

route.post("/feeds", async (c) => {
  const db = createDb(c.env.DB);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { recordName, displayName, description } = body as Record<string, unknown>;
  if (!recordName || !displayName) {
    return c.json({ error: "recordName and displayName are required" }, 400);
  }
  const [feed] = await db
    .insert(feedsTable)
    .values({
      recordName: String(recordName),
      displayName: String(displayName),
      description: description ? String(description) : null,
    })
    .returning();
  return c.json({ ...feed, postCount: 0 }, 201);
});

route.get("/feeds/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);
  const feed = await getFeedWithCount(db, id);
  if (!feed) return c.json({ error: "Feed not found" }, 404);
  return c.json(feed);
});

route.patch("/feeds/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const updates: Partial<typeof feedsTable.$inferInsert> = {};
  if (body.displayName != null) updates.displayName = String(body.displayName);
  if (body.description !== undefined) updates.description = body.description ? String(body.description) : null;
  if (body.isActive != null) updates.isActive = Boolean(body.isActive);
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl ? String(body.avatarUrl) : null;
  updates.updatedAt = new Date().toISOString();
  const [updated] = await db.update(feedsTable).set(updates).where(eq(feedsTable.id, id)).returning();
  if (!updated) return c.json({ error: "Feed not found" }, 404);
  const feed = await getFeedWithCount(db, updated.id);
  return c.json(feed);
});

route.delete("/feeds/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);
  const [deleted] = await db.delete(feedsTable).where(eq(feedsTable.id, id)).returning();
  if (!deleted) return c.json({ error: "Feed not found" }, 404);
  return new Response(null, { status: 204 });
});

route.get("/feeds/:id/keywords", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);
  const keywords = await db
    .select()
    .from(keywordsTable)
    .where(eq(keywordsTable.feedId, id))
    .orderBy(keywordsTable.createdAt);
  return c.json(keywords);
});

route.post("/feeds/:id/keywords", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { keyword } = body as Record<string, unknown>;
  if (!keyword) return c.json({ error: "keyword is required" }, 400);
  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return c.json({ error: "Feed not found" }, 404);
  const [kw] = await db
    .insert(keywordsTable)
    .values({ feedId: id, keyword: String(keyword).toLowerCase() })
    .returning();
  return c.json(kw, 201);
});

route.delete("/feeds/:id/keywords/:keywordId", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  const keywordId = parseInt(c.req.param("keywordId"), 10);
  if (isNaN(id) || isNaN(keywordId)) return c.json({ error: "Invalid ID" }, 400);
  const [deleted] = await db
    .delete(keywordsTable)
    .where(and(eq(keywordsTable.id, keywordId), eq(keywordsTable.feedId, id)))
    .returning();
  if (!deleted) return c.json({ error: "Keyword not found" }, 404);
  return new Response(null, { status: 204 });
});

route.get("/feeds/:id/posts", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);
  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return c.json({ error: "Feed not found" }, 404);

  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const cursor = c.req.query("cursor");

  const tagCondition = sql`instr(',' || ${indexedPostsTable.algoTags} || ',', ',' || ${feed.recordName} || ',') > 0`;
  const conditions = [tagCondition];
  if (cursor) {
    const [ts] = cursor.split("::");
    conditions.push(lt(indexedPostsTable.indexedAt, ts));
  }

  const mode = c.req.query("mode") || "recent";

  let posts: unknown[];
  let actualMode = mode;

  if (mode === "ranked") {
    const rankedRows = await db
      .select({
        post: indexedPostsTable,
        rank: feedRankedPostsTable.rank,
        finalScore: feedRankedPostsTable.finalScore,
        qualityScore: feedRankedPostsTable.qualityScore,
        computedAt: feedRankedPostsTable.computedAt,
      })
      .from(feedRankedPostsTable)
      .innerJoin(indexedPostsTable, eq(feedRankedPostsTable.postUri, indexedPostsTable.uri))
      .where(eq(feedRankedPostsTable.feedId, feed.id))
      .orderBy(feedRankedPostsTable.rank)
      .limit(limit);

    if (rankedRows.length > 0) {
      // Flatten: spread the indexed post fields then overlay rank/score fields
      posts = rankedRows.map(r => ({
        ...r.post,
        rank: r.rank,
        finalScore: r.finalScore,
        qualityScore: r.qualityScore,
        computedAt: r.computedAt,
      }));
    } else {
      // Fallback to recency when ranking table is empty (first run)
      posts = await db
        .select()
        .from(indexedPostsTable)
        .where(and(...conditions))
        .orderBy(desc(indexedPostsTable.indexedAt))
        .limit(limit);
      actualMode = "recent";
    }
  } else {
    posts = await db
      .select()
      .from(indexedPostsTable)
      .where(and(...conditions))
      .orderBy(desc(indexedPostsTable.indexedAt))
      .limit(limit);
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(indexedPostsTable)
    .where(sql`instr(',' || ${indexedPostsTable.algoTags} || ',', ',' || ${feed.recordName} || ',') > 0`);

  let nextCursor: string | undefined;
  if (mode !== "ranked" && posts.length >= limit) {
    const last = posts[posts.length - 1] as typeof indexedPostsTable.$inferSelect;
    nextCursor = `${last.indexedAt}::${last.cid}`;
  }

  return c.json({ posts, cursor: nextCursor, total, mode: actualMode });
});

route.post("/feeds/:id/publish", async (c) => {
  const db = createDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid feed ID" }, 400);

  const hostname = c.env.FEEDGEN_HOSTNAME;
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  const handle = c.env.BLUESKY_HANDLE;
  const appPassword = c.env.BLUESKY_APP_PASSWORD;

  const missing = [
    !hostname && "FEEDGEN_HOSTNAME",
    !publisherDid && "FEEDGEN_PUBLISHER_DID",
    !handle && "BLUESKY_HANDLE",
    !appPassword && "BLUESKY_APP_PASSWORD",
  ].filter(Boolean);
  if (missing.length > 0) {
    return c.json({ error: "Missing configuration", missing }, 400);
  }

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) return c.json({ error: "Feed not found" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.login({ identifier: handle, password: appPassword });

    // Build record — upload avatar blob if set
    const record: Record<string, unknown> = {
      did: `did:web:${hostname}`,
      displayName: feed.displayName,
      description: feed.description ?? undefined,
      createdAt: feed.publishedAt ?? new Date().toISOString(),
    };

    const feedAvatarUrl = (feed as unknown as Record<string, unknown>).avatarUrl as string | null | undefined;
    if (feedAvatarUrl && (feedAvatarUrl.startsWith("data:") || feedAvatarUrl.startsWith("http"))) {
      try {
        let bytes: Uint8Array;
        let mimeType: string;

        if (feedAvatarUrl.startsWith("data:")) {
          const [header, b64] = feedAvatarUrl.split(",");
          mimeType = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
          const bin = atob(b64);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } else {
          const res = await fetch(feedAvatarUrl);
          mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
          bytes = new Uint8Array(await res.arrayBuffer());
        }

        if (bytes.length > 0 && agent.session?.accessJwt) {
          const uploadRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.uploadBlob", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${agent.session.accessJwt}`,
              "Content-Type": mimeType,
            },
            body: bytes,
          });
          if (uploadRes.ok) {
            const blobData = await uploadRes.json() as { blob: unknown };
            if (blobData.blob) record.avatar = blobData.blob;
          } else {
            console.warn("[publish] Blob upload HTTP error:", uploadRes.status, await uploadRes.text());
          }
        }
      } catch (err) {
        console.warn("[publish] Avatar upload skipped:", err instanceof Error ? err.message : String(err));
      }
    }

    const result = await agent.api.com.atproto.repo.putRecord({
      repo: publisherDid,
      collection: "app.bsky.feed.generator",
      rkey: feed.recordName,
      record,
    });

    await db
      .update(feedsTable)
      .set({ publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(feedsTable.id, id));

    return c.json({ uri: result.data.uri, cid: result.data.cid });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Failed to publish feed", message }, 500);
  }
});

// ── Auto-amplify settings (stored as cron_settings JSON) ─────────────────────

route.get("/feeds/:id/auto-amplify", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
  const key = `auto_amplify_feed_${id}`;
  const row = await c.env.DB.prepare("SELECT value FROM cron_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  if (!row) return c.json({ enabled: false, minScore: 0.3, maxPerDay: 3, delayMinutes: 60 });
  try {
    return c.json({ enabled: false, minScore: 0.3, maxPerDay: 3, delayMinutes: 60, ...JSON.parse(row.value) });
  } catch {
    return c.json({ enabled: false, minScore: 0.3, maxPerDay: 3, delayMinutes: 60 });
  }
});

route.post("/feeds/:id/auto-amplify", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const key = `auto_amplify_feed_${id}`;
  const value = JSON.stringify(body);
  await c.env.DB.prepare(
    "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')",
  )
    .bind(key, value, value)
    .run();
  return c.json(body);
});

// ── Feed Boost settings (stored as cron_settings JSON) ───────────────────────
// Boost posts a promotional Bluesky update about the feed on a weekly schedule.

const BOOST_DEFAULTS = {
  enabled: false,
  dayOfWeek: 1,
  hourUtc: 9,
  template: null as string | null,
  lastBoostedAt: null as string | null,
};

route.get("/feeds/:id/boost", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
  const key = `feed_boost_${id}`;
  const row = await c.env.DB.prepare("SELECT value FROM cron_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  if (!row) return c.json(BOOST_DEFAULTS);
  try {
    return c.json({ ...BOOST_DEFAULTS, ...JSON.parse(row.value) });
  } catch {
    return c.json(BOOST_DEFAULTS);
  }
});

route.post("/feeds/:id/boost", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
  let body: Partial<typeof BOOST_DEFAULTS>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const merged = { ...BOOST_DEFAULTS, ...body };
  const key = `feed_boost_${id}`;
  const value = JSON.stringify(merged);
  await c.env.DB.prepare(
    "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')",
  )
    .bind(key, value, value)
    .run();
  return c.json(merged);
});

export default route;
