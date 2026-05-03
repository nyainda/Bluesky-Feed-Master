import { Hono } from "hono";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

async function getAuthenticatedAgent(env: Env) {
  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: env.BLUESKY_HANDLE,
    password: env.BLUESKY_APP_PASSWORD,
  });
  return agent;
}

route.get("/bluesky/followers", async (c) => {
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  if (!publisherDid) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const cursor = c.req.query("cursor");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);

    const result = await agent.getFollowers({ actor: publisherDid, limit, cursor });
    return c.json({
      users: result.data.followers.map((f) => ({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName ?? null,
        avatar: f.avatar ?? null,
        description: f.description ?? null,
        followersCount: f.followersCount ?? 0,
        followsCount: f.followsCount ?? 0,
        followedAt: null,
      })),
      cursor: result.data.cursor,
    });
  } catch (err) {
    console.error("Failed to fetch followers:", err);
    return c.json({ error: "Failed to fetch followers" }, 500);
  }
});

route.get("/bluesky/following", async (c) => {
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  if (!publisherDid) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const cursor = c.req.query("cursor");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);

    const result = await agent.getFollows({ actor: publisherDid, limit, cursor });
    return c.json({
      users: result.data.follows.map((f) => ({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName ?? null,
        avatar: f.avatar ?? null,
        description: f.description ?? null,
        followersCount: f.followersCount ?? 0,
        followsCount: f.followsCount ?? 0,
        followedAt: null,
      })),
      cursor: result.data.cursor,
    });
  } catch (err) {
    console.error("Failed to fetch following:", err);
    return c.json({ error: "Failed to fetch following" }, 500);
  }
});

route.post("/bluesky/follow", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { did } = body as Record<string, unknown>;
  if (!did) return c.json({ error: "did is required" }, 400);

  try {
    const agent = await getAuthenticatedAgent(c.env);
    await agent.follow(String(did));
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Failed to follow user", message }, 500);
  }
});

route.post("/bluesky/unfollow", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { followUri } = body as Record<string, unknown>;
  if (!followUri) return c.json({ error: "followUri is required" }, 400);

  try {
    const agent = await getAuthenticatedAgent(c.env);
    await agent.deleteFollow(String(followUri));
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Failed to unfollow user", message }, 500);
  }
});

route.post("/bluesky/sync-engagement", async (c) => {
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  if (!publisherDid) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  let body: { feedId?: number | null; limit?: number } = {};
  try { body = await c.req.json(); } catch { /* no body */ }
  const limit = Math.min(body.limit ?? 100, 200);

  const db = (await import("../db")).createDb(c.env.DB);
  const { indexedPostsTable, feedsTable } = await import("../db/schema");
  const { desc, like, and, inArray } = await import("drizzle-orm");

  try {
    const conditions: ReturnType<typeof like>[] = [];
    if (body.feedId) {
      const [feed] = await db.select().from(feedsTable).where(
        (await import("drizzle-orm")).eq(feedsTable.id, body.feedId)
      ).limit(1);
      if (!feed) return c.json({ error: "Feed not found" }, 404);
      conditions.push(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));
    }

    const posts = await db
      .select({ id: indexedPostsTable.id, uri: indexedPostsTable.uri })
      .from(indexedPostsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(indexedPostsTable.indexedAt))
      .limit(limit);

    if (posts.length === 0) return c.json({ updated: 0, skipped: 0, errors: 0 });

    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const BATCH = 25;
    let updated = 0, errors = 0;

    for (let i = 0; i < posts.length; i += BATCH) {
      const batch = posts.slice(i, i + BATCH);
      try {
        const result = await agent.getPosts({ uris: batch.map(p => p.uri) });
        for (const post of result.data.posts) {
          const dbPost = batch.find(p => p.uri === post.uri);
          if (!dbPost) continue;
          await db.update(indexedPostsTable)
            .set({
              likes: post.likeCount ?? 0,
              reposts: post.repostCount ?? 0,
              replies: post.replyCount ?? 0,
              quotes: post.quoteCount ?? 0,
              engagementSyncedAt: new Date().toISOString(),
            })
            .where(inArray(indexedPostsTable.id, [dbPost.id]));
          updated++;
        }
      } catch {
        errors += batch.length;
      }
    }

    return c.json({ updated, skipped: posts.length - updated - errors, errors });
  } catch (err) {
    console.error("sync-engagement failed:", err);
    return c.json({ error: "Sync failed" }, 500);
  }
});

route.get("/bluesky/not-following-back", async (c) => {
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  if (!publisherDid) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  // Paginate one page at a time via cursor to stay within CPU limits
  const followingCursor = c.req.query("followingCursor");
  const followerCursor = c.req.query("followerCursor");
  const pageSize = 100;

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });

    // Fetch one page of following
    const followingResult = await agent.getFollows({
      actor: publisherDid,
      limit: pageSize,
      cursor: followingCursor,
    });

    // Fetch one page of followers to build exclusion set
    const followerResult = await agent.getFollowers({
      actor: publisherDid,
      limit: pageSize,
      cursor: followerCursor,
    });

    const followerDids = new Set(followerResult.data.followers.map((f) => f.did));

    const notFollowingBack = followingResult.data.follows
      .filter((f) => !followerDids.has(f.did))
      .map((u) => ({
        did: u.did,
        handle: u.handle,
        displayName: u.displayName ?? null,
        avatar: u.avatar ?? null,
        followersCount: u.followersCount ?? 0,
        followsCount: u.followsCount ?? 0,
        followedAt: null,
      }));

    return c.json({
      users: notFollowingBack,
      nextFollowingCursor: followingResult.data.cursor ?? null,
      nextFollowerCursor: followerResult.data.cursor ?? null,
      hasMore: !!followingResult.data.cursor,
    });
  } catch (err) {
    console.error("not-following-back failed:", err);
    return c.json({ error: "Failed to compute not-following-back list" }, 500);
  }
});

route.get("/bluesky/search-users", async (c) => {
  const q = c.req.query("q");
  if (!q || q.length < 2) return c.json({ error: "q must be at least 2 characters" }, 400);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const result = await agent.searchActors({ q, limit: 20 });

    const BOT_SIGNALS = ["bot", "automated", "feed", "spam", "test", "auto"];
    const users = result.data.actors
      .filter((a) => {
        const text = `${a.handle} ${a.displayName ?? ""} ${a.description ?? ""}`.toLowerCase();
        const hasFollowers = Number(a.followersCount ?? 0) > 5;
        const looksLikeBot = BOT_SIGNALS.some((s) => text.includes(s));
        return hasFollowers && !looksLikeBot;
      })
      .map((a) => ({
        did: a.did,
        handle: a.handle,
        displayName: a.displayName ?? null,
        avatar: a.avatar ?? null,
        description: a.description ?? null,
        followersCount: a.followersCount ?? 0,
        followsCount: a.followsCount ?? 0,
      }));

    return c.json(users);
  } catch (err) {
    console.error("Failed to search users:", err);
    return c.json({ error: "Failed to search users" }, 500);
  }
});

export default route;
