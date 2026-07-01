import { Hono } from "hono";
import type { Env } from "../index";
import { getAutoFollowSettings, saveAutoFollowSettings } from "../lib/auto-follow";
import { getFollowQueueStatus, clearFollowQueue } from "../lib/scheduled-follow";

const app = new Hono<{ Bindings: Env }>();

app.get("/follow-settings", async (c) => {
  try {
    const settings = await getAutoFollowSettings(c.env);
    return c.json({ ok: true, settings });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/follow-settings", async (c) => {
  try {
    const body = await c.req.json<{
      enabled?: boolean;
      intervalDays?: number;
      cap?: number;
      markets?: string[];
      minFollowers?: number;
      maxFollowers?: number;
      minPosts?: number;
      followbackDays?: number;
      targetFollowCount?: number;
    }>();
    await saveAutoFollowSettings(c.env, body);
    const settings = await getAutoFollowSettings(c.env);
    return c.json({ ok: true, settings });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/bluesky/follow-queue/status", async (c) => {
  try {
    const status = await getFollowQueueStatus(c.env);
    return c.json({ ok: true, ...status });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.delete("/bluesky/follow-queue", async (c) => {
  try {
    await clearFollowQueue(c.env);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/auto-follow/log", async (c) => {
  try {
    const limit = Math.min(100, parseInt(c.req.query("limit") ?? "50", 10));
    const rows = await c.env.DB.prepare(
      `SELECT did, handle, followers_count, market, followed_at, follow_back_status, follow_back_checked_at
       FROM auto_follow_log
       ORDER BY followed_at DESC
       LIMIT ?`,
    ).bind(limit).all<{
      did: string;
      handle: string;
      followers_count: number;
      market: string;
      followed_at: string;
      follow_back_status: string;
      follow_back_checked_at: string | null;
    }>();
    return c.json({ ok: true, entries: rows.results });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default app;
