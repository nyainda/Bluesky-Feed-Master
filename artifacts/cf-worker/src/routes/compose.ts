import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { createDb, followerSnapshotsTable } from "../db";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

// GET /api/bluesky/follower-growth
route.get("/bluesky/follower-growth", async (c) => {
  const db = createDb(c.env.DB);
  try {
    const snapshots = await db
      .select()
      .from(followerSnapshotsTable)
      .orderBy(desc(followerSnapshotsTable.recordedAt))
      .limit(90);

    return c.json(snapshots.map(s => ({
      id: s.id,
      followersCount: s.followersCount,
      followsCount: s.followsCount,
      postsCount: s.postsCount,
      recordedAt: s.recordedAt,
    })));
  } catch (err) {
    console.error("getFollowerGrowth failed:", err);
    return c.json({ error: "Failed to fetch follower growth" }, 500);
  }
});

// POST /api/bluesky/snapshot-followers
route.post("/bluesky/snapshot-followers", async (c) => {
  const did = c.env.FEEDGEN_PUBLISHER_DID;
  if (!did) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const profile = await agent.getProfile({ actor: did });
    const p = profile.data;

    const db = createDb(c.env.DB);
    const [snapshot] = await db
      .insert(followerSnapshotsTable)
      .values({
        followersCount: p.followersCount ?? 0,
        followsCount: p.followsCount ?? 0,
        postsCount: p.postsCount ?? 0,
      })
      .returning();

    return c.json({
      id: snapshot.id,
      followersCount: snapshot.followersCount,
      followsCount: snapshot.followsCount,
      postsCount: snapshot.postsCount,
      recordedAt: snapshot.recordedAt,
    });
  } catch (err) {
    console.error("snapshotFollowers failed:", err);
    return c.json({ error: "Failed to record snapshot" }, 500);
  }
});

// POST /api/bluesky/compose
route.post("/bluesky/compose", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }

  let body: { text?: string; threadPosts?: string[] } = {};
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.text?.trim()) return c.json({ error: "text is required" }, 400);

  try {
    const { AtpAgent, RichText } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.login({ identifier: c.env.BLUESKY_HANDLE, password: c.env.BLUESKY_APP_PASSWORD });

    const posts = body.threadPosts && body.threadPosts.length > 0
      ? [body.text, ...body.threadPosts]
      : [body.text];

    let replyRef: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } } | undefined;
    let rootRef: { uri: string; cid: string } | undefined;

    for (const text of posts) {
      const rt = new RichText({ text });
      await rt.detectFacets(agent);
      const result = await agent.post({
        text: rt.text,
        facets: rt.facets,
        reply: replyRef,
      });
      if (!rootRef) rootRef = { uri: result.uri, cid: result.cid };
      replyRef = { root: rootRef, parent: { uri: result.uri, cid: result.cid } };
    }

    return c.json({ success: true, uri: rootRef?.uri });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("compose failed:", err);
    return c.json({ error: "Failed to post", message }, 500);
  }
});

export default route;
