import { Hono } from "hono";
import { asc, desc, eq } from "drizzle-orm";
import { createDb, followerSnapshotsTable, scheduledPostsTable } from "../db";
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

// GET /api/bluesky/scheduled
route.get("/bluesky/scheduled", async (c) => {
  const db = createDb(c.env.DB);
  try {
    const posts = await db
      .select()
      .from(scheduledPostsTable)
      .orderBy(asc(scheduledPostsTable.scheduledAt));

    return c.json(posts.map(p => ({
      id: p.id,
      text: p.text,
      threadParts: p.threadParts,
      isThread: p.isThread,
      scheduledAt: p.scheduledAt,
      sentAt: p.sentAt,
      status: p.status,
      errorMessage: p.errorMessage,
      createdAt: p.createdAt,
    })));
  } catch (err) {
    console.error("listScheduledPosts failed:", err);
    return c.json({ error: "Failed to list scheduled posts" }, 500);
  }
});

// POST /api/bluesky/scheduled
route.post("/bluesky/scheduled", async (c) => {
  let body: { text?: string; threadParts?: string[]; isThread?: boolean; scheduledAt?: string } = {};
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.text?.trim()) return c.json({ error: "text is required" }, 400);
  if (!body.scheduledAt) return c.json({ error: "scheduledAt is required" }, 400);

  const scheduledDate = new Date(body.scheduledAt);
  if (isNaN(scheduledDate.getTime())) return c.json({ error: "Invalid scheduledAt date" }, 400);
  if (scheduledDate <= new Date()) return c.json({ error: "scheduledAt must be in the future" }, 400);

  const db = createDb(c.env.DB);
  try {
    const [post] = await db.insert(scheduledPostsTable).values({
      text: body.text.trim(),
      threadParts: body.isThread && Array.isArray(body.threadParts) ? JSON.stringify(body.threadParts) : null,
      isThread: body.isThread ?? false,
      scheduledAt: scheduledDate.toISOString(),
      status: "pending",
    }).returning();

    return c.json({
      id: post.id,
      text: post.text,
      threadParts: post.threadParts,
      isThread: post.isThread,
      scheduledAt: post.scheduledAt,
      sentAt: null,
      status: post.status,
      errorMessage: null,
      createdAt: post.createdAt,
    }, 201);
  } catch (err) {
    console.error("createScheduledPost failed:", err);
    return c.json({ error: "Failed to schedule post" }, 500);
  }
});

// DELETE /api/bluesky/scheduled/:id
route.delete("/bluesky/scheduled/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const db = createDb(c.env.DB);
  try {
    await db.delete(scheduledPostsTable).where(eq(scheduledPostsTable.id, id));
    return c.json({ ok: true });
  } catch (err) {
    console.error("deleteScheduledPost failed:", err);
    return c.json({ error: "Failed to delete scheduled post" }, 500);
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
