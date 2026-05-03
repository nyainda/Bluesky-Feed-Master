import { Router, type IRouter } from "express";
import { AtpAgent } from "@atproto/api";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const handle = () => process.env.BLUESKY_HANDLE || "";
const appPassword = () => process.env.BLUESKY_APP_PASSWORD || "";

async function getAuthAgent(): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle(), password: appPassword() });
  return agent;
}

// GET /api/bluesky/notifications
router.get("/bluesky/notifications", async (req, res): Promise<void> => {
  const h = handle();
  const p = appPassword();
  if (!h || !p) {
    res.status(400).json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" });
    return;
  }

  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 100);
  const reasons = req.query.reasons as string | string[] | undefined;

  try {
    const agent = await getAuthAgent();
    const result = await agent.listNotifications({
      limit,
      cursor,
      reasons: reasons ? (Array.isArray(reasons) ? reasons : [reasons]) : undefined,
    });

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

    res.json({
      notifications,
      cursor: result.data.cursor ?? null,
      seenAt: result.data.seenAt ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "listNotifications failed");
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// POST /api/bluesky/notifications/seen
router.post("/bluesky/notifications/seen", async (req, res): Promise<void> => {
  const h = handle();
  const p = appPassword();
  if (!h || !p) {
    res.status(400).json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" });
    return;
  }
  try {
    const agent = await getAuthAgent();
    await agent.updateSeenNotifications({ seenAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "updateSeenNotifications failed");
    res.status(500).json({ error: "Failed to mark notifications as seen" });
  }
});

// GET /api/bluesky/notifications/unread-count
router.get("/bluesky/notifications/unread-count", async (req, res): Promise<void> => {
  const h = handle();
  const p = appPassword();
  if (!h || !p) { res.json({ count: 0 }); return; }
  try {
    const agent = await getAuthAgent();
    const result = await agent.countUnreadNotifications();
    res.json({ count: result.data.count });
  } catch (err) {
    req.log.error({ err }, "countUnreadNotifications failed");
    res.json({ count: 0 });
  }
});

export default router;
