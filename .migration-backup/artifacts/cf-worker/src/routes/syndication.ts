import { Hono } from "hono";
import type { Env } from "../index";
import { syndicatePost } from "../lib/syndication";
import { scheduleAmplification, deleteAmplification } from "../lib/amplifier";
import { generateFeedRss } from "../lib/rss";

const route = new Hono<{ Bindings: Env }>();

// ─── Platforms ───────────────────────────────────────────────────────────────

route.get("/syndication/platforms", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, platform, label, config_json, enabled, created_at FROM syndication_platforms ORDER BY id",
  ).all<{ id: number; platform: string; label: string; config_json: string; enabled: number; created_at: string }>();

  const platforms = (rows.results ?? []).map((r) => {
    const config = JSON.parse(r.config_json) as Record<string, string>;
    // Redact secrets — only expose whether keys are set, not values
    const safeConfig: Record<string, boolean | string> = {};
    for (const key of Object.keys(config)) {
      if (key === "instanceUrl") safeConfig[key] = config[key] as string;
      else safeConfig[key] = !!config[key];
    }
    return { id: r.id, platform: r.platform, label: r.label, config: safeConfig, enabled: r.enabled === 1, createdAt: r.created_at };
  });

  return c.json({ platforms });
});

route.post("/syndication/platforms", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { platform, label, config } = body as Record<string, unknown>;
  if (!platform || !label || !config || typeof config !== "object") {
    return c.json({ error: "platform, label, config required" }, 400);
  }

  const validPlatforms = ["mastodon", "twitter", "threads"];
  if (!validPlatforms.includes(String(platform))) {
    return c.json({ error: `platform must be one of: ${validPlatforms.join(", ")}` }, 400);
  }

  const result = await c.env.DB.prepare(
    "INSERT INTO syndication_platforms (platform, label, config_json, enabled) VALUES (?, ?, ?, 1)",
  )
    .bind(String(platform), String(label), JSON.stringify(config))
    .run();

  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

route.patch("/syndication/platforms/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { enabled, label, config } = body as Record<string, unknown>;

  if (typeof enabled === "boolean") {
    await c.env.DB.prepare("UPDATE syndication_platforms SET enabled = ? WHERE id = ?")
      .bind(enabled ? 1 : 0, id)
      .run();
  }
  if (typeof label === "string") {
    await c.env.DB.prepare("UPDATE syndication_platforms SET label = ? WHERE id = ?")
      .bind(label, id)
      .run();
  }
  if (config && typeof config === "object") {
    // Merge config: read existing, then overlay new values
    const existing = await c.env.DB.prepare("SELECT config_json FROM syndication_platforms WHERE id = ?")
      .bind(id)
      .first<{ config_json: string }>();
    if (existing) {
      const merged = { ...JSON.parse(existing.config_json), ...(config as Record<string, unknown>) };
      await c.env.DB.prepare("UPDATE syndication_platforms SET config_json = ? WHERE id = ?")
        .bind(JSON.stringify(merged), id)
        .run();
    }
  }

  return c.json({ ok: true });
});

route.delete("/syndication/platforms/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  await c.env.DB.prepare("DELETE FROM syndication_platforms WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ─── Manual cross-post trigger ────────────────────────────────────────────────

route.post("/syndication/trigger", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { postUri, text } = body as Record<string, unknown>;
  if (!postUri || !text) return c.json({ error: "postUri and text required" }, 400);

  try {
    await syndicatePost(c.env, String(postUri), String(text));
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

// ─── Syndication Log ──────────────────────────────────────────────────────────

route.get("/syndication/log", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const rows = await c.env.DB.prepare(
    "SELECT id, post_uri, platform, status, external_id, error, created_at FROM syndication_log ORDER BY id DESC LIMIT ?",
  )
    .bind(limit)
    .all<{ id: number; post_uri: string; platform: string; status: string; external_id: string | null; error: string | null; created_at: string }>();

  return c.json({ log: rows.results ?? [] });
});

// ─── Amplification ────────────────────────────────────────────────────────────

route.get("/syndication/amplify", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, post_uri, post_text, amplify_at, status, done_at, error, created_at FROM amplification_queue ORDER BY amplify_at ASC LIMIT 50",
  ).all<{ id: number; post_uri: string; post_text: string; amplify_at: string; status: string; done_at: string | null; error: string | null; created_at: string }>();

  return c.json({ queue: rows.results ?? [] });
});

route.post("/syndication/amplify", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { postUri, postCid, postText, amplifyAt } = body as Record<string, unknown>;
  if (!postUri || !postCid || !amplifyAt) return c.json({ error: "postUri, postCid, amplifyAt required" }, 400);

  const amplifyDate = new Date(String(amplifyAt));
  if (isNaN(amplifyDate.getTime())) return c.json({ error: "Invalid amplifyAt date" }, 400);
  if (amplifyDate <= new Date()) return c.json({ error: "amplifyAt must be in the future" }, 400);

  const id = await scheduleAmplification(c.env, String(postUri), String(postCid), String(postText || ""), amplifyDate.toISOString());
  return c.json({ ok: true, id }, 201);
});

route.delete("/syndication/amplify/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  await deleteAmplification(c.env, id);
  return c.json({ ok: true });
});

// ─── RSS Feed ─────────────────────────────────────────────────────────────────

route.get("/feeds/:id/rss", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return new Response("Invalid feed id", { status: 400 });

  const xml = await generateFeedRss(c.env, id);
  if (!xml) return new Response("Feed not found", { status: 404 });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
});

export default route;
