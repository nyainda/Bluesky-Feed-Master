import { Hono } from "hono";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

async function getAuthenticatedAgent(env: Env) {
  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: env.BLUESKY_HANDLE,
    password: env.BLUESKY_APP_PASSWORD,
  });
  return agent;
}

route.get("/bluesky/followers", async (c) => {
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  if (!publisherDid) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const cursor = c.req.query("cursor");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);

    const result = await agent.getFollowers({ actor: publisherDid, limit, cursor });
    return c.json({
      followers: result.data.followers.map((f) => ({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName ?? null,
        avatar: f.avatar ?? null,
        description: f.description ?? null,
        followersCount: f.followersCount ?? 0,
      })),
      cursor: result.data.cursor,
    });
  } catch (err) {
    console.error("Failed to fetch followers:", err);
    return c.json({ error: "Failed to fetch followers" }, 500);
  }
});

route.get("/bluesky/following", async (c) => {
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID;
  if (!publisherDid) return c.json({ error: "FEEDGEN_PUBLISHER_DID not configured" }, 404);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const cursor = c.req.query("cursor");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);

    const result = await agent.getFollows({ actor: publisherDid, limit, cursor });
    return c.json({
      following: result.data.follows.map((f) => ({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName ?? null,
        avatar: f.avatar ?? null,
      })),
      cursor: result.data.cursor,
    });
  } catch (err) {
    console.error("Failed to fetch following:", err);
    return c.json({ error: "Failed to fetch following" }, 500);
  }
});

route.post("/bluesky/follow", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { did } = body as Record<string, unknown>;
  if (!did) return c.json({ error: "did is required" }, 400);

  try {
    const agent = await getAuthenticatedAgent(c.env);
    await agent.follow(String(did));
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Failed to follow user", message }, 500);
  }
});

route.post("/bluesky/unfollow", async (c) => {
  if (!c.env.BLUESKY_HANDLE || !c.env.BLUESKY_APP_PASSWORD) {
    return c.json({ error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required" }, 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { followUri } = body as Record<string, unknown>;
  if (!followUri) return c.json({ error: "followUri is required" }, 400);

  try {
    const agent = await getAuthenticatedAgent(c.env);
    await agent.deleteFollow(String(followUri));
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Failed to unfollow user", message }, 500);
  }
});

route.get("/bluesky/search-users", async (c) => {
  const q = c.req.query("q");
  if (!q || q.length < 2) return c.json({ error: "q must be at least 2 characters" }, 400);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const result = await agent.searchActors({ q, limit: 20 });

    const BOT_SIGNALS = ["bot", "automated", "feed", "spam", "test", "auto"];
    const users = result.data.actors
      .filter((a) => {
        const text = `${a.handle} ${a.displayName ?? ""} ${a.description ?? ""}`.toLowerCase();
        const hasFollowers = Number(a.followersCount ?? 0) > 5;
        const looksLikeBot = BOT_SIGNALS.some((s) => text.includes(s));
        return hasFollowers && !looksLikeBot;
      })
      .map((a) => ({
        did: a.did,
        handle: a.handle,
        displayName: a.displayName ?? null,
        avatar: a.avatar ?? null,
        description: a.description ?? null,
        followersCount: a.followersCount ?? 0,
        followsCount: a.followsCount ?? 0,
      }));

    return c.json(users);
  } catch (err) {
    console.error("Failed to search users:", err);
    return c.json({ error: "Failed to search users" }, 500);
  }
});

export default route;
