import { Hono } from "hono";
import { eq, like, desc, and, lt } from "drizzle-orm";
import { createDb, feedsTable, indexedPostsTable } from "../db";
import type { Env } from "../index";

const route = new Hono<{ Bindings: Env }>();

route.get("/.well-known/did.json", (c) => {
  const hostname = c.env.FEEDGEN_HOSTNAME || "your-worker.workers.dev";
  const serviceDid = `did:web:${hostname}`;
  return c.json({
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: serviceDid,
    service: [
      {
        id: "#bsky_fg",
        type: "BskyFeedGenerator",
        serviceEndpoint: `https://${hostname}`,
      },
    ],
  });
});

route.get("/xrpc/app.bsky.feed.describeFeedGenerator", async (c) => {
  const db = createDb(c.env.DB);
  const hostname = c.env.FEEDGEN_HOSTNAME || "your-worker.workers.dev";
  const publisherDid = c.env.FEEDGEN_PUBLISHER_DID || "";
  const serviceDid = `did:web:${hostname}`;

  const feeds = await db.select().from(feedsTable).where(eq(feedsTable.isActive, true));

  return c.json({
    did: serviceDid,
    feeds: feeds.map((f) => ({
      uri: `at://${publisherDid}/app.bsky.feed.generator/${f.recordName}`,
    })),
  });
});

route.get("/xrpc/app.bsky.feed.getFeedSkeleton", async (c) => {
  const db = createDb(c.env.DB);
  const feedUri = c.req.query("feed");
  const limit = Math.min(parseInt(c.req.query("limit") || "30", 10), 100);
  const cursor = c.req.query("cursor");

  // ── Geo context from Cloudflare ──────────────────────────────────────────
  // CF populates request.cf with geographic metadata at the edge PoP closest
  // to the requester. We surface these as response headers so the dashboard
  // and ATProto clients can see which region served the request.
  const cf = (c.req.raw as { cf?: Record<string, unknown> }).cf ?? {};
  const country  = (cf["country"]  as string | undefined) ?? "XX";
  const continent = (cf["continent"] as string | undefined) ?? "unknown";
  const colo     = (cf["colo"]     as string | undefined) ?? "unknown";
  const region   = (cf["region"]   as string | undefined) ?? "";

  if (!feedUri) {
    return c.json({ error: "MissingFeed", message: "feed parameter required" }, 400);
  }

  const parts = feedUri.split("/");
  const algoName = parts[parts.length - 1];

  const [feed] = await db
    .select()
    .from(feedsTable)
    .where(eq(feedsTable.recordName, algoName));

  if (!feed) {
    return c.json({ error: "UnsupportedAlgorithm", message: `Unknown feed: ${algoName}` }, 404);
  }

  try {
    const conditions = [like(indexedPostsTable.algoTags, `%${feed.recordName}%`)];
    if (cursor) {
      const [ts] = cursor.split("::");
      conditions.push(lt(indexedPostsTable.indexedAt, ts));
    }

    const posts = await db
      .select()
      .from(indexedPostsTable)
      .where(and(...conditions))
      .orderBy(desc(indexedPostsTable.indexedAt))
      .limit(limit);

    const skeleton = posts.map((p) => ({ post: p.uri }));

    let nextCursor: string | undefined;
    if (posts.length >= limit) {
      const last = posts[posts.length - 1];
      nextCursor = `${last.indexedAt}::${last.cid}`;
    }

    // ── Edge caching — feed skeletons are public and shared across all users.
    // CF edge PoPs worldwide will cache the response for 30s, slashing latency
    // for readers in US, EU, APAC without hitting D1 on every request.
    // Browser/ATProto clients revalidate every 15s.
    c.header("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
    c.header("CDN-Cache-Control", "max-age=30");
    c.header("Vary", "Accept");

    // ── Geo routing headers — visible in dashboard diagnostics ───────────────
    c.header("X-Served-Country",   country);
    c.header("X-Served-Continent", continent);
    c.header("X-Served-Colo",      colo);
    if (region) c.header("X-Served-Region", region);

    return c.json({ feed: skeleton, cursor: nextCursor });
  } catch (err) {
    console.error(`Error serving feed ${algoName}:`, err);
    return c.json({ error: "InternalServerError" }, 500);
  }
});

// ── Geo info endpoint — lets the dashboard show which CF PoP is serving ──────
route.get("/api/geo", (c) => {
  const cf = (c.req.raw as { cf?: Record<string, unknown> }).cf ?? {};
  return c.json({
    country:    (cf["country"]   as string | undefined) ?? "XX",
    continent:  (cf["continent"] as string | undefined) ?? "unknown",
    colo:       (cf["colo"]      as string | undefined) ?? "unknown",
    city:       (cf["city"]      as string | undefined) ?? null,
    region:     (cf["region"]    as string | undefined) ?? null,
    latitude:   (cf["latitude"]  as string | undefined) ?? null,
    longitude:  (cf["longitude"] as string | undefined) ?? null,
    timezone:   (cf["timezone"]  as string | undefined) ?? null,
  });
});

export default route;
