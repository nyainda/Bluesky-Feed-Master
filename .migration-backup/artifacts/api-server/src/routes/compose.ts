import { Router, type IRouter } from "express";
import { AtpAgent, RichText } from "@atproto/api";
import { db, scheduledPostsTable, followerSnapshotsTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const handle = () => process.env.BLUESKY_HANDLE || "";
const appPassword = () => process.env.BLUESKY_APP_PASSWORD || "";

async function getAuthAgent(): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle(), password: appPassword() });
  return agent;
}

async function postWithRichText(agent: AtpAgent, text: string, replyRef?: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } }) {
  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  return agent.post({ text: rt.text, facets: rt.facets, reply: replyRef });
}

// POST /api/bluesky/compose
router.post("/bluesky/compose", async (req, res): Promise<void> => {
  const h = handle(); const p = appPassword();
  if (!h || !p) { res.status(400).json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }); return; }

  const { text, threadParts, isThread } = req.body as { text: string; threadParts?: string[]; isThread?: boolean };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }

  try {
    const agent = await getAuthAgent();

    if (isThread && Array.isArray(threadParts) && threadParts.length > 0) {
      // Post thread: first post is `text`, rest are threadParts
      const allParts = [text, ...threadParts].filter(t => t?.trim());
      const uris: string[] = [];
      let rootRef: { uri: string; cid: string } | null = null;
      let parentRef: { uri: string; cid: string } | null = null;

      for (const part of allParts) {
        const replyRef = rootRef && parentRef ? { root: rootRef, parent: parentRef } : undefined;
        const result = await postWithRichText(agent, part.trim(), replyRef);
        if (!rootRef) rootRef = { uri: result.uri, cid: result.cid };
        parentRef = { uri: result.uri, cid: result.cid };
        uris.push(result.uri);
        // Small delay between thread posts
        if (uris.length < allParts.length) await new Promise(r => setTimeout(r, 500));
      }

      res.json({ uri: uris[0], cid: rootRef!.cid, uris });
    } else {
      const result = await postWithRichText(agent, text.trim());
      res.json({ uri: result.uri, cid: result.cid, uris: [result.uri] });
    }
  } catch (err) {
    req.log.error({ err }, "composePost failed");
    res.status(500).json({ error: `Failed to post: ${String(err)}` });
  }
});

// GET /api/bluesky/scheduled
router.get("/bluesky/scheduled", async (_req, res): Promise<void> => {
  try {
    const posts = await db
      .select()
      .from(scheduledPostsTable)
      .orderBy(asc(scheduledPostsTable.scheduledAt));

    res.json(posts.map(p => ({
      id: p.id,
      text: p.text,
      threadParts: p.threadParts,
      isThread: p.isThread,
      scheduledAt: p.scheduledAt.toISOString(),
      sentAt: p.sentAt ? p.sentAt.toISOString() : null,
      status: p.status,
      errorMessage: p.errorMessage,
      createdAt: p.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "listScheduledPosts failed");
    res.status(500).json({ error: "Failed to list scheduled posts" });
  }
});

// POST /api/bluesky/scheduled
router.post("/bluesky/scheduled", async (req, res): Promise<void> => {
  const { text, threadParts, isThread, scheduledAt } = req.body as {
    text: string; threadParts?: string[]; isThread?: boolean; scheduledAt: string;
  };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  if (!scheduledAt) { res.status(400).json({ error: "scheduledAt is required" }); return; }

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) { res.status(400).json({ error: "Invalid scheduledAt date" }); return; }
  if (scheduledDate <= new Date()) { res.status(400).json({ error: "scheduledAt must be in the future" }); return; }

  try {
    const [post] = await db.insert(scheduledPostsTable).values({
      text: text.trim(),
      threadParts: isThread && Array.isArray(threadParts) ? JSON.stringify(threadParts) : null,
      isThread: isThread ?? false,
      scheduledAt: scheduledDate,
      status: "pending",
    }).returning();

    res.status(201).json({
      id: post.id,
      text: post.text,
      threadParts: post.threadParts,
      isThread: post.isThread,
      scheduledAt: post.scheduledAt.toISOString(),
      sentAt: null,
      status: post.status,
      errorMessage: null,
      createdAt: post.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "createScheduledPost failed");
    res.status(500).json({ error: "Failed to schedule post" });
  }
});

// DELETE /api/bluesky/scheduled/:id
router.delete("/bluesky/scheduled/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(scheduledPostsTable).where(eq(scheduledPostsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "deleteScheduledPost failed");
    res.status(500).json({ error: "Failed to delete scheduled post" });
  }
});

// Follower snapshot
// POST /api/bluesky/snapshot-followers
router.post("/bluesky/snapshot-followers", async (req, res): Promise<void> => {
  const did = process.env.FEEDGEN_PUBLISHER_DID;
  if (!did) { res.status(404).json({ error: "FEEDGEN_PUBLISHER_DID not configured" }); return; }
  try {
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const profile = await agent.getProfile({ actor: did });
    const [snap] = await db.insert(followerSnapshotsTable).values({
      followersCount: profile.data.followersCount ?? 0,
      followsCount: profile.data.followsCount ?? 0,
      postsCount: profile.data.postsCount ?? 0,
    }).returning();
    res.json({
      id: snap.id,
      followersCount: snap.followersCount,
      followsCount: snap.followsCount,
      postsCount: snap.postsCount,
      recordedAt: snap.recordedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "snapshotFollowers failed");
    res.status(500).json({ error: "Failed to snapshot followers" });
  }
});

// GET /api/bluesky/follower-growth
router.get("/bluesky/follower-growth", async (_req, res): Promise<void> => {
  try {
    const snaps = await db
      .select()
      .from(followerSnapshotsTable)
      .orderBy(asc(followerSnapshotsTable.recordedAt))
      .limit(90);
    res.json(snaps.map(s => ({
      id: s.id,
      followersCount: s.followersCount,
      followsCount: s.followsCount,
      postsCount: s.postsCount,
      recordedAt: s.recordedAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "getFollowerGrowth failed");
    res.status(500).json({ error: "Failed to fetch follower growth" });
  }
});

// Background scheduler: every 60s, send due posts
export function startScheduler(): void {
  setInterval(async () => {
    try {
      const now = new Date();
      const due = await db
        .select()
        .from(scheduledPostsTable)
        .where(eq(scheduledPostsTable.status, "pending"))
        .orderBy(asc(scheduledPostsTable.scheduledAt));

      const overdue = due.filter(p => p.scheduledAt <= now);
      if (overdue.length === 0) return;

      const h = handle(); const p = appPassword();
      if (!h || !p) { logger.warn("Scheduler: BLUESKY credentials not set, skipping"); return; }

      for (const post of overdue) {
        try {
          const agent = new AtpAgent({ service: "https://bsky.social" });
          await agent.login({ identifier: h, password: p });

          const uris: string[] = [];
          if (post.isThread && post.threadParts) {
            const parts = JSON.parse(post.threadParts) as string[];
            const allParts = [post.text, ...parts].filter(t => t?.trim());
            let rootRef: { uri: string; cid: string } | null = null;
            let parentRef: { uri: string; cid: string } | null = null;
            for (const part of allParts) {
              const replyRef = rootRef && parentRef ? { root: rootRef, parent: parentRef } : undefined;
              const result = await postWithRichText(agent, part.trim(), replyRef);
              if (!rootRef) rootRef = { uri: result.uri, cid: result.cid };
              parentRef = { uri: result.uri, cid: result.cid };
              uris.push(result.uri);
              if (uris.length < allParts.length) await new Promise(r => setTimeout(r, 500));
            }
          } else {
            const result = await postWithRichText(agent, post.text.trim());
            uris.push(result.uri);
          }

          await db.update(scheduledPostsTable).set({ status: "sent", sentAt: new Date() }).where(eq(scheduledPostsTable.id, post.id));
          logger.info({ postId: post.id, uris }, "Scheduled post sent");
        } catch (err) {
          await db.update(scheduledPostsTable).set({ status: "failed", errorMessage: String(err) }).where(eq(scheduledPostsTable.id, post.id));
          logger.error({ err, postId: post.id }, "Scheduled post failed");
        }
      }
    } catch (err) {
      logger.error({ err }, "Scheduler tick failed");
    }
  }, 60_000);
  logger.info("Post scheduler started");
}

export default router;
