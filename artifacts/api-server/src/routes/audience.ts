import { Router, type IRouter } from "express";
import { AtpAgent } from "@atproto/api";
import { db, indexedPostsTable } from "@workspace/db";
import { desc, isNull, or, lt, like, and, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const publisherDid = () => process.env.FEEDGEN_PUBLISHER_DID || "";
const handle = () => process.env.BLUESKY_HANDLE || "";
const appPassword = () => process.env.BLUESKY_APP_PASSWORD || "";

async function getPublicAgent() {
  return new AtpAgent({ service: "https://public.api.bsky.app" });
}

async function getAuthAgent(): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle(), password: appPassword() });
  return agent;
}

function mapUser(u: {
  did: string; handle: string;
  displayName?: string; avatar?: string; description?: string;
  followersCount?: number; followsCount?: number;
}) {
  return {
    did: u.did,
    handle: u.handle,
    displayName: u.displayName ?? null,
    avatar: u.avatar ?? null,
    description: u.description ?? null,
    followersCount: u.followersCount ?? 0,
    followsCount: u.followsCount ?? 0,
    followedAt: null,
  };
}

// POST /api/bluesky/sync-engagement
router.post("/bluesky/sync-engagement", async (req, res): Promise<void> => {
  const did = publisherDid();
  if (!did) { res.status(404).json({ error: "FEEDGEN_PUBLISHER_DID not configured" }); return; }

  const body = req.body as { feedId?: number | null; limit?: number };
  const limit = Math.min(body.limit ?? 100, 200);

  try {
    // Get recent posts that need syncing
    const conditions: ReturnType<typeof like>[] = [];
    if (body.feedId) {
      const [feed] = await db.query.feedsTable.findMany({ where: (t, { eq }) => eq(t.id, body.feedId!) });
      if (!feed) { res.status(404).json({ error: "Feed not found" }); return; }
      conditions.push(like(indexedPostsTable.algoTags, `%${feed.recordName}%`));
    }

    const posts = await db
      .select({ id: indexedPostsTable.id, uri: indexedPostsTable.uri })
      .from(indexedPostsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(indexedPostsTable.indexedAt))
      .limit(limit);

    if (posts.length === 0) { res.json({ updated: 0, skipped: 0, errors: 0 }); return; }

    const agent = await getPublicAgent();

    // Bluesky API allows max 25 URIs per getPosts call
    const BATCH = 25;
    let updated = 0, errors = 0;

    for (let i = 0; i < posts.length; i += BATCH) {
      const batch = posts.slice(i, i + BATCH);
      const uris = batch.map(p => p.uri);
      try {
        const result = await agent.getPosts({ uris });
        for (const post of result.data.posts) {
          const dbPost = batch.find(p => p.uri === post.uri);
          if (!dbPost) continue;
          await db
            .update(indexedPostsTable)
            .set({
              likes: post.likeCount ?? 0,
              reposts: post.repostCount ?? 0,
              replies: post.replyCount ?? 0,
              quotes: post.quoteCount ?? 0,
              engagementSyncedAt: new Date(),
            })
            .where(inArray(indexedPostsTable.id, [dbPost.id]));
          updated++;
        }
      } catch (err) {
        logger.error({ err }, `Engagement sync batch ${i}-${i + BATCH} failed`);
        errors += batch.length;
      }
    }

    res.json({ updated, skipped: posts.length - updated - errors, errors });
  } catch (err) {
    req.log.error({ err }, "Sync engagement failed");
    res.status(500).json({ error: "Sync failed" });
  }
});

// GET /api/bluesky/followers
router.get("/bluesky/followers", async (req, res): Promise<void> => {
  const did = publisherDid();
  if (!did) { res.status(404).json({ error: "Not configured" }); return; }

  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || "50"), 100);

  try {
    const agent = await getPublicAgent();
    const result = await agent.getFollowers({ actor: did, limit, cursor });
    res.json({
      users: result.data.followers.map(mapUser),
      cursor: result.data.cursor ?? null,
      total: result.data.followers.length,
    });
  } catch (err) {
    req.log.error({ err }, "getFollowers failed");
    res.status(500).json({ error: "Failed to fetch followers" });
  }
});

// GET /api/bluesky/following
router.get("/bluesky/following", async (req, res): Promise<void> => {
  const did = publisherDid();
  if (!did) { res.status(404).json({ error: "Not configured" }); return; }

  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || "50"), 100);

  try {
    const agent = await getPublicAgent();
    const result = await agent.getFollows({ actor: did, limit, cursor });
    res.json({
      users: result.data.follows.map(mapUser),
      cursor: result.data.cursor ?? null,
      total: result.data.follows.length,
    });
  } catch (err) {
    req.log.error({ err }, "getFollowing failed");
    res.status(500).json({ error: "Failed to fetch following" });
  }
});

// GET /api/bluesky/not-following-back
router.get("/bluesky/not-following-back", async (req, res): Promise<void> => {
  const did = publisherDid();
  if (!did) { res.status(404).json({ error: "Not configured" }); return; }

  try {
    const agent = await getPublicAgent();

    // Paginate through ALL following
    const following: { did: string; handle: string; displayName?: string; avatar?: string; followersCount?: number; followsCount?: number }[] = [];
    let followingCursor: string | undefined;
    do {
      const r = await agent.getFollows({ actor: did, limit: 100, cursor: followingCursor });
      following.push(...r.data.follows);
      followingCursor = r.data.cursor;
    } while (followingCursor && following.length < 2000);

    // Paginate through ALL followers
    const followerDids = new Set<string>();
    let followerCursor: string | undefined;
    do {
      const r = await agent.getFollowers({ actor: did, limit: 100, cursor: followerCursor });
      r.data.followers.forEach(f => followerDids.add(f.did));
      followerCursor = r.data.cursor;
    } while (followerCursor && followerDids.size < 10000);

    const notFollowingBack = following.filter(f => !followerDids.has(f.did));
    res.json(notFollowingBack.map(mapUser));
  } catch (err) {
    req.log.error({ err }, "notFollowingBack failed");
    res.status(500).json({ error: "Failed to compute not-following-back list" });
  }
});

// POST /api/bluesky/bulk-follow
router.post("/bluesky/bulk-follow", async (req, res): Promise<void> => {
  const h = handle(); const p = appPassword();
  if (!h || !p) { res.status(400).json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required for write operations" }); return; }

  const { dids } = req.body as { dids: string[] };
  if (!Array.isArray(dids) || dids.length === 0) { res.status(400).json({ error: "dids array required" }); return; }

  try {
    const agent = await getAuthAgent();
    let succeeded = 0, failed = 0;
    const errors: string[] = [];

    for (const did of dids.slice(0, 50)) {
      try {
        await agent.follow(did);
        succeeded++;
        await new Promise(r => setTimeout(r, 200)); // rate limit friendly
      } catch (err) {
        failed++;
        errors.push(`${did}: ${String(err)}`);
      }
    }
    res.json({ succeeded, failed, errors });
  } catch (err) {
    req.log.error({ err }, "bulkFollow failed");
    res.status(500).json({ error: "Bulk follow failed" });
  }
});

// POST /api/bluesky/bulk-unfollow
router.post("/bluesky/bulk-unfollow", async (req, res): Promise<void> => {
  const h = handle(); const p = appPassword();
  if (!h || !p) { res.status(400).json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required for write operations" }); return; }

  const { dids } = req.body as { dids: string[] };
  if (!Array.isArray(dids) || dids.length === 0) { res.status(400).json({ error: "dids array required" }); return; }

  try {
    const agent = await getAuthAgent();
    let succeeded = 0, failed = 0;
    const errors: string[] = [];

    for (const did of dids.slice(0, 100)) {
      try {
        // Get the follow record URI first
        const profile = await agent.getProfile({ actor: did });
        const followUri = (profile.data as { viewer?: { following?: string } }).viewer?.following;
        if (!followUri) { failed++; errors.push(`${did}: not following`); continue; }

        const parts = followUri.split("/");
        await agent.deleteFollow(followUri);
        succeeded++;
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        failed++;
        errors.push(`${did}: ${String(err)}`);
      }
    }
    res.json({ succeeded, failed, errors });
  } catch (err) {
    req.log.error({ err }, "bulkUnfollow failed");
    res.status(500).json({ error: "Bulk unfollow failed" });
  }
});

export default router;
