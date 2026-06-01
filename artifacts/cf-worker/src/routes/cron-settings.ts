import { Hono } from "hono";
import type { Env } from "../index";
import { getAutoUnfollowSettings, saveAutoUnfollowSettings } from "../lib/auto-unfollow";

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

route.post("/cron-settings", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { enabled, intervalDays, cap } = body as Record<string, unknown>;

  if (typeof enabled !== "boolean") {
    return c.json({ ok: false, error: "enabled (boolean) is required" }, 400);
  }
  if (typeof intervalDays !== "number" || intervalDays < 1) {
    return c.json({ ok: false, error: "intervalDays (number >= 1) is required" }, 400);
  }
  if (typeof cap !== "number" || cap < 1 || cap > 200) {
    return c.json({ ok: false, error: "cap (number 1–200) is required" }, 400);
  }

  try {
    await saveAutoUnfollowSettings(c.env, {
      enabled,
      intervalDays: Math.floor(intervalDays),
      cap: Math.floor(cap),
    });
    const settings = await getAutoUnfollowSettings(c.env);
    return c.json({ ok: true, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

export default route;
