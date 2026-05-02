import { Router, type IRouter } from "express";
import { db, feedsTable, keywordsTable, indexedPostsTable } from "@workspace/db";
import { eq, like, desc, and, lt } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const hostname = process.env.FEEDGEN_HOSTNAME || "localhost";
const publisherDid = process.env.FEEDGEN_PUBLISHER_DID || "";
const serviceDid = process.env.FEEDGEN_SERVICE_DID || `did:web:${hostname}`;

router.get("/.well-known/did.json", (_req, res): void => {
  res.json({
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

router.get("/xrpc/app.bsky.feed.describeFeedGenerator", async (_req, res): Promise<void> => {
  const feeds = await db.select().from(feedsTable).where(eq(feedsTable.isActive, true));

  res.json({
    did: serviceDid,
    feeds: feeds.map((f) => ({
      uri: `at://${publisherDid}/app.bsky.feed.generator/${f.recordName}`,
    })),
  });
});

router.get("/xrpc/app.bsky.feed.getFeedSkeleton", async (req, res): Promise<void> => {
  const feedUri = req.query.feed as string;
  const limit = Math.min(parseInt((req.query.limit as string) || "30"), 100);
  const cursor = req.query.cursor as string | undefined;

  if (!feedUri) {
    res.status(400).json({ error: "MissingFeed", message: "feed parameter required" });
    return;
  }

  const parts = feedUri.split("/");
  const algoName = parts[parts.length - 1];

  const [feed] = await db
    .select()
    .from(feedsTable)
    .where(and(eq(feedsTable.recordName, algoName), eq(feedsTable.isActive, true)));

  if (!feed) {
    res.status(404).json({ error: "UnsupportedAlgorithm", message: `Unknown feed: ${algoName}` });
    return;
  }

  try {
    const conditions = [like(indexedPostsTable.algoTags, `%${feed.recordName}%`)];

    if (cursor) {
      const [ts] = cursor.split("::");
      conditions.push(lt(indexedPostsTable.indexedAt, new Date(ts)));
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
      nextCursor = `${last.indexedAt.toISOString()}::${last.cid}`;
    }

    res.json({ feed: skeleton, cursor: nextCursor });
  } catch (err) {
    req.log.error({ err }, `Error serving feed ${algoName}`);
    res.status(500).json({ error: "InternalServerError" });
  }
});

export default router;
