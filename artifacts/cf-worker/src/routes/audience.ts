import { Hono } from "hono";
import type { Env } from "../index";
import {
  enqueueScheduledUnfollowItems,
  getScheduledUnfollowStatus,
  clearScheduledUnfollowQueue,
} from "../lib/scheduled-unfollow";
import { getAutoFollowSettings } from "../lib/auto-follow";

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

// Bluesky getFollowers/getFollows return ProfileView which has NO followersCount/followsCount.
// Those fields only exist on ProfileViewDetailed, returned by getProfiles. Batch-fetch to enrich.
async function batchGetProfileDetails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any,
  dids: string[]
): Promise<Map<string, { followersCount: number; followsCount: number }>> {
  const map = new Map<string, { followersCount: number; followsCount: number }>();
  if (dids.length === 0) return map;
  const batches: string[][] = [];
  for (let i = 0; i < dids.length; i += 25) batches.push(dids.slice(i, i + 25));
  const results = await Promise.all(
    batches.map((batch) => agent.getProfiles({ actors: batch }).catch(() => null))
  );
  for (const result of results) {
    if (!result) continue;
    for (const p of result.data.profiles) {
      map.set(p.did, { followersCount: p.followersCount ?? 0, followsCount: p.followsCount ?? 0 });
    }
  }
  return map;
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
    // getFollowers returns ProfileView[] (no counts) — enrich with ProfileViewDetailed via getProfiles
    const details = await batchGetProfileDetails(agent, result.data.followers.map((f) => f.did));
    return c.json({
      users: result.data.followers.map((f) => {
        const d = details.get(f.did);
        return {
          did: f.did,
          handle: f.handle,
          displayName: f.displayName ?? null,
          avatar: f.avatar ?? null,
          description: f.description ?? null,
          followersCount: d?.followersCount ?? 0,
          followsCount: d?.followsCount ?? 0,
          followedAt: null,
        };
      }),
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
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }

  try {
    const agent = await getAuthenticatedAgent(c.env);
    const cursor = c.req.query("cursor");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);

    const result = await agent.getFollows({ actor: publisherDid, limit, cursor });
    // getFollows returns ProfileView[] (no counts) — enrich with ProfileViewDetailed via getProfiles
    const details = await batchGetProfileDetails(agent, result.data.follows.map((f) => f.did));
    return c.json({
      users: result.data.follows.map((f) => {
        const d = details.get(f.did);
        return {
          did: f.did,
          handle: f.handle,
          displayName: f.displayName ?? null,
          avatar: f.avatar ?? null,
          description: f.description ?? null,
          followersCount: d?.followersCount ?? 0,
          followsCount: d?.followsCount ?? 0,
          followedAt: null,
          followUri: f.viewer?.following ?? null,
        };
      }),
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

route.post("/bluesky/bulk-follow", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { dids } = body as Record<string, unknown>;
  if (!Array.isArray(dids) || dids.length === 0) {
    return c.json({ error: "dids must be a non-empty array" }, 400);
  }

  // Queue into the drain system (handles any size, 40/tick = ~4,800/day)
  const { enqueueFollowItems, ensureFollowQueueTable, runScheduledFollow } = await import("../lib/scheduled-follow");
  await ensureFollowQueueTable(c.env);
  const items = dids.map((did) => ({ did: String(did), handle: "", followersCount: 0, market: "bulk" }));
  const { enqueued, skipped } = await enqueueFollowItems(c.env, items);

  // Kick off an immediate partial drain so the first 40 follow right away
  c.executionCtx.waitUntil(runScheduledFollow(c.env));

  return c.json({ succeeded: enqueued, failed: 0, enqueued, skipped,
    message: `${enqueued} queued for follow (${skipped} already tracked). First batch draining now.` });
});

route.post("/bluesky/bulk-unfollow", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { dids, followUris } = body as Record<string, unknown>;

  if ((!Array.isArray(dids) || dids.length === 0) && (!Array.isArray(followUris) || followUris.length === 0)) {
    return c.json({ error: "dids or followUris must be a non-empty array" }, 400);
  }

  // Queue into the drain system (handles any size, 100/tick = ~2,000/hour)
  const { enqueueScheduledUnfollowItems, ensureScheduledUnfollowTable, runScheduledUnfollow } = await import("../lib/scheduled-unfollow");
  await ensureScheduledUnfollowTable(c.env);

  // Build items — prefer followUris for fast-path (no profile lookup needed during drain)
  const unfollowItems: Array<{ did: string; followUri?: string | null }> = [];
  if (Array.isArray(followUris) && followUris.length > 0) {
    // followUris provided: pair them with dids if available
    const didArr = Array.isArray(dids) ? dids.map(String) : [];
    followUris.forEach((uri, i) => {
      unfollowItems.push({ did: didArr[i] ?? `bulk-${i}`, followUri: String(uri) });
    });
  } else if (Array.isArray(dids)) {
    dids.forEach((did) => unfollowItems.push({ did: String(did), followUri: null }));
  }

  const { enqueued, skipped } = await enqueueScheduledUnfollowItems(c.env, unfollowItems);

  // Kick off an immediate partial drain so the first 100 unfollow right away
  c.executionCtx.waitUntil(runScheduledUnfollow(c.env));

  return c.json({ succeeded: enqueued, failed: 0, enqueued, skipped,
    message: `${enqueued} queued for unfollow (${skipped} already tracked). First batch draining now.` });
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
      const tag = feed.recordName;
      conditions.push(
        (await import("drizzle-orm")).sql`instr(',' || ${indexedPostsTable.algoTags} || ',', ',' || ${tag} || ',') > 0` as unknown as ReturnType<typeof like>
      );
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
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }

  const cursor = c.req.query("cursor") || undefined;
  const pageSize = 100;

  try {
    const agent = await getAuthenticatedAgent(c.env);

    // Authenticated getFollows: viewer.following = the publisher's follow record URI for each person (needed for unfollow)
    // viewer.followedBy = the follow record URI if they follow the publisher back (used for NFB filter)
    const result = await agent.getFollows({
      actor: publisherDid,
      limit: pageSize,
      cursor,
    });

    const nfbUsers = result.data.follows.filter((f) => !f.viewer?.followedBy);
    // getFollows returns ProfileView[] (no counts) — enrich with ProfileViewDetailed via getProfiles
    const details = await batchGetProfileDetails(agent, nfbUsers.map((u) => u.did));
    const notFollowingBack = nfbUsers.map((u) => {
      const d = details.get(u.did);
      return {
        did: u.did,
        handle: u.handle,
        displayName: u.displayName ?? null,
        avatar: u.avatar ?? null,
        description: u.description ?? null,
        followersCount: d?.followersCount ?? 0,
        followsCount: d?.followsCount ?? 0,
        followedAt: null,
        followUri: u.viewer?.following ?? null,
      };
    });

    return c.json({
      users: notFollowingBack,
      cursor: result.data.cursor ?? null,
      hasMore: !!result.data.cursor,
    });
  } catch (err) {
    console.error("not-following-back failed:", err);
    return c.json({ error: "Failed to compute not-following-back list" }, 500);
  }
});

// ── Like & Repost ─────────────────────────────────────────────────────────────

route.post("/bluesky/like", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD)
    return c.json({ error: "BLUESKY credentials not configured" }, 400);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const { uri, cid } = body as Record<string, unknown>;
  if (!uri || !cid) return c.json({ error: "uri and cid are required" }, 400);
  try {
    const agent = await getAuthenticatedAgent(c.env);
    const result = await agent.like(String(uri), String(cid));
    return c.json({ ok: true, likeUri: result.uri });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

route.delete("/bluesky/like", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD)
    return c.json({ error: "BLUESKY credentials not configured" }, 400);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const { likeUri } = body as Record<string, unknown>;
  if (!likeUri) return c.json({ error: "likeUri is required" }, 400);
  try {
    const agent = await getAuthenticatedAgent(c.env);
    await agent.deleteLike(String(likeUri));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

route.post("/bluesky/repost", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD)
    return c.json({ error: "BLUESKY credentials not configured" }, 400);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const { uri, cid } = body as Record<string, unknown>;
  if (!uri || !cid) return c.json({ error: "uri and cid are required" }, 400);
  try {
    const agent = await getAuthenticatedAgent(c.env);
    const result = await agent.repost(String(uri), String(cid));
    return c.json({ ok: true, repostUri: result.uri });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ── Server-side scheduled unfollow queue ─────────────────────────────────────

route.post("/bluesky/unfollow-schedule", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY credentials not configured" }, 400);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { items } = body as Record<string, unknown>;
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: "items must be a non-empty array of {did, followUri?}" }, 400);
  }
  try {
    const result = await enqueueScheduledUnfollowItems(c.env, items as Array<{ did: string; followUri?: string }>);
    return c.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

route.get("/bluesky/unfollow-schedule/status", async (c) => {
  try {
    const status = await getScheduledUnfollowStatus(c.env);
    return c.json({ ok: true, ...status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

route.delete("/bluesky/unfollow-schedule", async (c) => {
  try {
    await clearScheduledUnfollowQueue(c.env);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
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

    return c.json({ users, cursor: result.data.cursor ?? null });
  } catch (err) {
    console.error("Failed to search users:", err);
    return c.json({ error: "Failed to search users" }, 500);
  }
});

// ─── Auto-Follow Stats ────────────────────────────────────────────────────────
route.get("/bluesky/auto-follow/stats", async (c) => {
  try {
    const settings = await getAutoFollowSettings(c.env);

    let queuePending = 0;
    let queueTotal = 0;
    let recentLog: Array<{
      did: string;
      handle: string;
      followers_count: number;
      market: string;
      followed_at: string;
      follow_back_status: string;
    }> = [];

    try {
      const qRow = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM auto_follow_queue WHERE status = 'pending'",
      ).first<{ cnt: number }>();
      queuePending = Number(qRow?.cnt ?? 0);

      const qtRow = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM auto_follow_queue",
      ).first<{ cnt: number }>();
      queueTotal = Number(qtRow?.cnt ?? 0);
    } catch {}

    try {
      const logRows = await c.env.DB.prepare(
        "SELECT did, handle, followers_count, market, followed_at, follow_back_status FROM auto_follow_log ORDER BY followed_at DESC LIMIT 20",
      ).all<{
        did: string;
        handle: string;
        followers_count: number;
        market: string;
        followed_at: string;
        follow_back_status: string;
      }>();
      recentLog = logRows.results;
    } catch {}

    return c.json({
      settings,
      queuePending,
      queueTotal,
      recentLog,
      cronSchedule: "every 3 minutes",
    });
  } catch (err) {
    console.error("Failed to fetch auto-follow stats:", err);
    return c.json({ error: "Failed to fetch auto-follow stats" }, 500);
  }
});

// ─── Follow Queue Status ──────────────────────────────────────────────────────
route.get("/auto-follow/queue-status", async (c) => {
  try {
    const { getFollowQueueStatus } = await import("../lib/scheduled-follow");
    const status = await getFollowQueueStatus(c.env);
    return c.json({ ok: true, ...status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message, pending: 0, done: 0, failed: 0, total: 0, estimatedMinutesLeft: 0 }, 500);
  }
});

route.post("/auto-follow/queue-clear", async (c) => {
  try {
    const { clearFollowQueue } = await import("../lib/scheduled-follow");
    await clearFollowQueue(c.env);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

route.get("/bluesky/search-actors", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ users: [], cursor: null });
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 25);
  const cursor = c.req.query("cursor");

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const result = await agent.searchActors({ q, limit, cursor });
    return c.json({
      users: result.data.actors.map((a) => ({
        did: a.did,
        handle: a.handle,
        displayName: a.displayName ?? null,
        avatar: a.avatar ?? null,
        description: a.description ?? null,
        followersCount: a.followersCount ?? 0,
        followsCount: a.followsCount ?? 0,
        postsCount: a.postsCount ?? 0,
        followedAt: null,
      })),
      cursor: result.data.cursor ?? null,
    });
  } catch (err) {
    console.error("[search-actors]", err);
    return c.json({ error: "Search failed" }, 500);
  }
});

export default route;
