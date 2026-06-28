import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, feedsTable } from "@workspace/db";
import { AtpAgent, RichText } from "@atproto/api";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/feeds/:id/publish", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid feed ID" });
    return;
  }

  const hostname = process.env.FEEDGEN_HOSTNAME;
  const publisherDid = process.env.FEEDGEN_PUBLISHER_DID;
  const handle = process.env.BLUESKY_HANDLE;
  const appPassword = process.env.BLUESKY_APP_PASSWORD;

  if (!hostname || !publisherDid || !handle || !appPassword) {
    const missing = [
      !hostname && "FEEDGEN_HOSTNAME",
      !publisherDid && "FEEDGEN_PUBLISHER_DID",
      !handle && "BLUESKY_HANDLE",
      !appPassword && "BLUESKY_APP_PASSWORD",
    ].filter(Boolean);
    res.status(400).json({
      error: "Missing configuration",
      missing,
      message: `Set these environment variables to publish: ${missing.join(", ")}`,
    });
    return;
  }

  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.id, id));
  if (!feed) {
    res.status(404).json({ error: "Feed not found" });
    return;
  }

  try {
    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.login({ identifier: handle, password: appPassword });

    const feedUri = `at://${publisherDid}/app.bsky.feed.generator/${feed.recordName}`;

    const record = {
      did: `did:web:${hostname}`,
      displayName: feed.displayName,
      description: feed.description ?? undefined,
      createdAt: feed.publishedAt?.toISOString() ?? new Date().toISOString(),
    };

    const result = await agent.api.com.atproto.repo.putRecord({
      repo: publisherDid,
      collection: "app.bsky.feed.generator",
      rkey: feed.recordName,
      record,
    });

    await db
      .update(feedsTable)
      .set({ publishedAt: new Date() })
      .where(eq(feedsTable.id, id));

    logger.info({ feedId: id, uri: result.data.uri }, "Feed published to Bluesky");

    res.json({
      uri: result.data.uri,
      cid: result.data.cid,
      feedUri,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, feedId: id }, "Failed to publish feed to Bluesky");
    res.status(500).json({ error: "Failed to publish feed", message });
  }
});

export default router;
