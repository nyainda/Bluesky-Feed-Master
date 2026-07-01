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

  // For small batches (≤ 25): follow directly — same fast path as manual follow.
  // For larger batches: follow the first 25 immediately, queue the rest for cron drain.
  const DIRECT_LIMIT = 25;
  const directDids = dids.slice(0, DIRECT_LIMIT).map(String);
  const queueDids  = dids.slice(DIRECT_LIMIT).map(String);

  const agent = await getAuthenticatedAgent(c.env);
  let succeeded = 0;
  let failed = 0;

  for (const did of directDids) {
    try {
      await agent.follow(did);
      succeeded++;
    } catch (err) {
      console.error(`[bulk-follow] direct follow failed did=${did}:`, err);
      failed++;
    }
  }

  let enqueued = 0;
  let skipped  = 0;
  if (queueDids.length > 0) {
    const { enqueueFollowItems, ensureFollowQueueTable } = await import("../lib/scheduled-follow");
    await ensureFollowQueueTable(c.env);
    const items = queueDids.map((did) => ({ did, handle: "", followersCount: 0, market: "bulk" }));
    const result = await enqueueFollowItems(c.env, items);
    enqueued = result.enqueued;
    skipped  = result.skipped;
  }

  const msg = queueDids.length > 0
    ? `${succeeded} followed instantly, ${failed} failed. ${enqueued} more queued for cron drain (${skipped} already tracked).`
    : `${succeeded} followed instantly, ${failed} failed.`;

  return c.json({ succeeded, failed, enqueued, skipped, message: msg });
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

  // Build a unified list of { did, followUri } pairs
  const allItems: Array<{ did: string; followUri: string | null }> = [];
  if (Array.isArray(followUris) && followUris.length > 0) {
    const didArr = Array.isArray(dids) ? dids.map(String) : [];
    followUris.forEach((uri, i) => {
      allItems.push({ did: didArr[i] ?? `bulk-${i}`, followUri: String(uri) });
    });
  } else if (Array.isArray(dids)) {
    dids.forEach((did) => allItems.push({ did: String(did), followUri: null }));
  }

  // For small batches (≤ 30 with URIs, ≤ 15 without): unfollow directly — same fast path as
  // manual unfollow. For larger batches: unfollow first chunk instantly, queue the rest.
  const hasUris    = allItems.some(i => i.followUri);
  const DIRECT_LIMIT = hasUris ? 30 : 15;
  const directItems = allItems.slice(0, DIRECT_LIMIT);
  const queueItems  = allItems.slice(DIRECT_LIMIT);

  const agent = await getAuthenticatedAgent(c.env);
  let succeeded = 0;
  let failed    = 0;

  for (const item of directItems) {
    try {
      let uri = item.followUri;
      if (!uri) {
        const profile = await agent.getProfile({ actor: item.did });
        uri = profile.data.viewer?.following ?? null;
      }
      if (uri) await agent.deleteFollow(uri);
      succeeded++;
    } catch (err) {
      console.error(`[bulk-unfollow] direct unfollow failed did=${item.did}:`, err);
      failed++;
    }
  }

  let enqueued = 0;
  let skipped  = 0;
  if (queueItems.length > 0) {
    const { enqueueScheduledUnfollowItems, ensureScheduledUnfollowTable } = await import("../lib/scheduled-unfollow");
    await ensureScheduledUnfollowTable(c.env);
    const result = await enqueueScheduledUnfollowItems(c.env, queueItems);
    enqueued = result.enqueued;
    skipped  = result.skipped;
  }

  const msg = queueItems.length > 0
    ? `${succeeded} unfollowed instantly, ${failed} failed. ${enqueued} more queued for cron drain (${skipped} already tracked).`
    : `${succeeded} unfollowed instantly, ${failed} failed.`;

  return c.json({ succeeded, failed, enqueued, skipped, message: msg });
});

route.post("/bluesky/unfollow-non-followers", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }

  let withinDays = 90;
  try {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.withinDays === "number" && body.withinDays > 0) withinDays = body.withinDays;
  } catch { /* no body — use default */ }

  // Query auto_follow_log for accounts followed within the window that never followed back
  const { ensureFollowQueueTable } = await import("../lib/scheduled-follow");
  await ensureFollowQueueTable(c.env);

  let rows: { results: Array<{ did: string; handle: string }> };
  try {
    rows = await c.env.DB.prepare(
      `SELECT did, handle FROM auto_follow_log
       WHERE follow_back_status != 'followed'
         AND datetime(followed_at, '+' || ? || ' days') > datetime('now', '-' || ? || ' days')
       ORDER BY followed_at ASC`
    ).bind(withinDays, withinDays).all<{ did: string; handle: string }>();
  } catch {
    return c.json({ error: "Failed to query follow log" }, 500);
  }

  if (rows.results.length === 0) {
    return c.json({ succeeded: 0, failed: 0, errors: [], message: `No non-followers found in the last ${withinDays} days.` });
  }

  // Unfollow directly up to 25, queue the rest
  const DIRECT_LIMIT = 25;
  const directRows = rows.results.slice(0, DIRECT_LIMIT);
  const queueRows  = rows.results.slice(DIRECT_LIMIT);

  const agent = await getAuthenticatedAgent(c.env);
  let succeeded = 0;
  let failed    = 0;

  for (const row of directRows) {
    try {
      const profile = await agent.getProfile({ actor: row.did });
      const uri = profile.data.viewer?.following ?? null;
      if (uri) {
        await agent.deleteFollow(uri);
        succeeded++;
      } else {
        // Not following anymore — count as done
        succeeded++;
      }
    } catch (err) {
      console.error(`[unfollow-non-followers] failed did=${row.did}:`, err);
      failed++;
    }
  }

  let enqueued = 0;
  let skipped  = 0;
  if (queueRows.length > 0) {
    const { enqueueScheduledUnfollowItems, ensureScheduledUnfollowTable } = await import("../lib/scheduled-unfollow");
    await ensureScheduledUnfollowTable(c.env);
    const result = await enqueueScheduledUnfollowItems(
      c.env,
      queueRows.map(r => ({ did: r.did, followUri: null }))
    );
    enqueued = result.enqueued;
    skipped  = result.skipped;
  }

  const total = rows.results.length;
  const msg = queueRows.length > 0
    ? `${succeeded} unfollowed instantly from ${total} non-followers (last ${withinDays}d). ${enqueued} more queued for cron.`
    : `${succeeded} non-followers unfollowed instantly (last ${withinDays}d), ${failed} failed.`;

  return c.json({ succeeded, failed, errors: [], enqueued, skipped, message: msg });
});

/**
 * Starts a cursor-based "queue all following" scan.
 * Sets a flag + empty cursor in D1 and returns immediately.
 * The feedforge-cron worker picks this up every 3 minutes and processes
 * 20 pages (2 000 accounts) per tick, saving the cursor after every 5 pages.
 * If CF kills the cron mid-tick, the next tick resumes at the last saved cursor.
 * 51k following ÷ 2k/tick = ~26 ticks = ~78 min total, zero data loss.
 */
route.post("/bluesky/queue-all-following", async (c) => {
  try {
    const { startQueueAllScan } = await import("../lib/queue-all-scan");
    await startQueueAllScan(c.env);
    return c.json({ ok: true, message: "Scan started — the cron will process 2,000 accounts every 3 minutes until all are queued." });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** Cancels an in-progress queue-all scan. */
route.delete("/bluesky/queue-all-following", async (c) => {
  try {
    const { cancelQueueAllScan } = await import("../lib/queue-all-scan");
    await cancelQueueAllScan(c.env);
    return c.json({ ok: true, message: "Scan cancelled." });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** Combined status for the mass-unfollow campaign: scan progress + queue drain status + last drain telemetry. */
route.get("/bluesky/unfollow-campaign/status", async (c) => {
  try {
    const { getQueueAllStatus } = await import("../lib/queue-all-scan");
    const { getScheduledUnfollowStatus } = await import("../lib/scheduled-unfollow");
    const [scan, queue] = await Promise.all([
      getQueueAllStatus(c.env),
      getScheduledUnfollowStatus(c.env),
    ]);

    // Drain telemetry written by runScheduledUnfollow each tick
    const telRows = await c.env.DB.prepare(
      `SELECT key, value FROM cron_settings
       WHERE key IN (
         'last_drain_at','last_drain_done','last_drain_failed','last_drain_error',
         'last_drain_attempted_at','last_drain_skip_reason','last_cron_tick'
       )`,
    ).all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] }));

    const tel: Record<string, string> = {};
    for (const r of telRows.results) tel[r.key] = r.value;

    const lastDrain = {
      at:          tel["last_drain_at"]           ?? null,
      done:        parseInt(tel["last_drain_done"]   ?? "0", 10) || 0,
      failed:      parseInt(tel["last_drain_failed"] ?? "0", 10) || 0,
      error:       tel["last_drain_error"]         ?? null,
      attemptedAt: tel["last_drain_attempted_at"]  ?? null,
      skipReason:  tel["last_drain_skip_reason"]   ?? null,
    };
    const lastCronTick = tel["last_cron_tick"] ?? null;

    return c.json({ ok: true, scan, queue, lastDrain, lastCronTick });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
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

// ─── Follow-back Stats (daily aggregates for chart) ──────────────────────────
route.get("/auto-follow/followback-stats", async (c) => {
  try {
    const days = Math.min(60, Math.max(7, parseInt(c.req.query("days") ?? "30", 10) || 30));

    // Totals by status (all time)
    const totalsRows = await c.env.DB.prepare(
      `SELECT follow_back_status, COUNT(*) as cnt FROM auto_follow_log GROUP BY follow_back_status`
    ).all<{ follow_back_status: string; cnt: number }>();
    const totals: Record<string, number> = { pending: 0, followed: 0, unfollowed: 0 };
    for (const r of totalsRows.results) totals[r.follow_back_status] = Number(r.cnt);

    // Daily new follows grouped by date (last N days)
    const dailyRows = await c.env.DB.prepare(
      `SELECT
         date(followed_at) as day,
         COUNT(*) as followed,
         SUM(CASE WHEN follow_back_status = 'followed' THEN 1 ELSE 0 END) as followed_back,
         SUM(CASE WHEN follow_back_status = 'unfollowed' THEN 1 ELSE 0 END) as unfollowed
       FROM auto_follow_log
       WHERE followed_at >= date('now', '-' || ? || ' days')
         AND followers_count != 0
       GROUP BY date(followed_at)
       ORDER BY day ASC`
    ).bind(days).all<{ day: string; followed: number; followed_back: number; unfollowed: number }>();

    const daily = dailyRows.results.map(r => ({
      day: r.day,
      followed: Number(r.followed),
      followedBack: Number(r.followed_back),
      unfollowed: Number(r.unfollowed),
      rate: Number(r.followed) > 0 ? Math.round((Number(r.followed_back) / Number(r.followed)) * 100) : 0,
    }));

    return c.json({ ok: true, totals, daily });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
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
