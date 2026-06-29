import { Hono } from "hono";
import type { Env } from "../index";
import { getAutoUnfollowSettings, saveAutoUnfollowSettings } from "../lib/auto-unfollow";
import { createDb } from "../db";
import { autoUnfollowLogTable } from "../db/schema";
import { desc } from "drizzle-orm";

const route = new Hono<{ Bindings: Env }>();

route.get("/cron-settings", async (c) => {
  try {
    // Ensure table exists in case migrate hasn't been run yet
    await c.env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS cron_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
    ).run();
    const settings = await getAutoUnfollowSettings(c.env);
    return c.json({ ok: true, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

route.post("/admin/reset-scan", async (c) => {
  try {
    await Promise.all([
      c.env.DB.prepare("INSERT INTO cron_settings (key, value) VALUES ('auto_unfollow_scan_cursor', '') ON CONFLICT(key) DO UPDATE SET value = '', updated_at = datetime('now')").run(),
      c.env.DB.prepare("INSERT INTO cron_settings (key, value) VALUES ('auto_unfollow_scan_pages_done', '0') ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = datetime('now')").run(),
    ]);
    return c.json({ ok: true, message: "Scan cursor reset — next trigger will start a fresh scan" });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

route.post("/cron-settings", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { enabled, intervalDays, cap, minFollowersToKeep } = body as Record<string, unknown>;

  if (typeof enabled !== "boolean") {
    return c.json({ ok: false, error: "enabled (boolean) is required" }, 400);
  }
  if (typeof intervalDays !== "number" || intervalDays < 1) {
    return c.json({ ok: false, error: "intervalDays (number >= 1) is required" }, 400);
  }
  // cap: 0 = unlimited (queue all), or 1–200000
  if (typeof cap !== "number" || cap < 0) {
    return c.json({ ok: false, error: "cap (number >= 0) is required" }, 400);
  }
  // minFollowersToKeep: 0 = unfollow everyone, else skip accounts with >= that many followers
  const minFollowers = typeof minFollowersToKeep === "number" ? Math.max(0, Math.floor(minFollowersToKeep)) : 0;

  try {
    await saveAutoUnfollowSettings(c.env, {
      enabled,
      intervalDays: Math.floor(intervalDays),
      cap: Math.floor(cap),
      minFollowersToKeep: minFollowers,
    });
    const settings = await getAutoUnfollowSettings(c.env);
    return c.json({ ok: true, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

route.get("/auto-unfollow/log", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  try {
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(autoUnfollowLogTable)
      .orderBy(desc(autoUnfollowLogTable.unfollowedAt))
      .limit(limit);
    return c.json({ ok: true, entries: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

export default route;
