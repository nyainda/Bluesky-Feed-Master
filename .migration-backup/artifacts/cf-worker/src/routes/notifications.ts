import { Hono } from "hono";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

async function getAuthenticatedAgent(env: Env) {
  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });
  return agent;
}

// GET /api/bluesky/notifications
route.get("/bluesky/notifications", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }

  const cursor = c.req.query("cursor") || undefined;
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const reasonsRaw = c.req.query("reasons");
  const reasons = reasonsRaw ? reasonsRaw.split(",") : undefined;

  try {
    const agent = await getAuthenticatedAgent(c.env);
    const result = await agent.listNotifications({ limit, cursor, reasons });

    const notifications = result.data.notifications.map((n) => ({
      uri: n.uri,
      cid: n.cid,
      reason: n.reason,
      isRead: n.isRead,
      indexedAt: n.indexedAt,
      author: {
        did: n.author.did,
        handle: n.author.handle,
        displayName: n.author.displayName ?? null,
        avatar: n.author.avatar ?? null,
      },
      record: n.record,
    }));

    return c.json({
      notifications,
      cursor: result.data.cursor ?? null,
      seenAt: result.data.seenAt ?? null,
    });
  } catch (err) {
    console.error("listNotifications failed:", err);
    return c.json({ error: "Failed to fetch notifications" }, 500);
  }
});

// POST /api/bluesky/notifications/seen
route.post("/bluesky/notifications/seen", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }
  try {
    const agent = await getAuthenticatedAgent(c.env);
    await agent.updateSeenNotifications({ seenAt: new Date().toISOString() });
    return c.json({ ok: true });
  } catch (err) {
    console.error("updateSeenNotifications failed:", err);
    return c.json({ error: "Failed to mark notifications as seen" }, 500);
  }
});

// GET /api/bluesky/notifications/unread-count
route.get("/bluesky/notifications/unread-count", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ count: 0 });
  }
  try {
    const agent = await getAuthenticatedAgent(c.env);
    const result = await agent.countUnreadNotifications();
    return c.json({ count: result.data.count });
  } catch (err) {
    console.error("countUnreadNotifications failed:", err);
    return c.json({ count: 0 });
  }
});

export default route;
