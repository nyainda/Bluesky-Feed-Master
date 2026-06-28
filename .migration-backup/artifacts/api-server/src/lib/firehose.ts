import { Jetstream } from "@skyware/jetstream";
import { logger } from "./logger";
import { db, indexedPostsTable, keywordsTable, feedsTable, subStateTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export const firehoseState = {
  connected: false,
  endpoint: process.env.FEEDGEN_SUBSCRIPTION_ENDPOINT || "wss://jetstream2.us-east.bsky.network/subscribe",
  reconnectCount: 0,
  lastEventAt: null as string | null,
  postsIndexedTotal: 0,
};

let jetstream: Jetstream | null = null;

async function getActiveKeywords(): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      keyword: keywordsTable.keyword,
      recordName: feedsTable.recordName,
    })
    .from(keywordsTable)
    .innerJoin(feedsTable, eq(keywordsTable.feedId, feedsTable.id))
    .where(eq(feedsTable.isActive, true));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const k = row.keyword.toLowerCase();
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(row.recordName);
  }
  return map;
}

export function startFirehose() {
  const endpoint = firehoseState.endpoint;
  logger.info({ endpoint }, "[Firehose] Connecting to Jetstream");

  jetstream = new Jetstream({
    wantedCollections: ["app.bsky.feed.post"],
    endpoint,
  });

  jetstream.on("open", () => {
    firehoseState.connected = true;
    logger.info("[Firehose] Connected");
  });

  jetstream.on("close", () => {
    firehoseState.connected = false;
    firehoseState.reconnectCount++;
    logger.warn("[Firehose] Disconnected, reconnecting in 3s...");
    setTimeout(() => startFirehose(), 3000);
  });

  jetstream.on("error", (err: Error) => {
    logger.error({ err }, "[Firehose] Error");
  });

  jetstream.onCreate("app.bsky.feed.post", async (event) => {
    const post = event.commit?.record as { text?: string; langs?: string[] } | undefined;
    if (!post || typeof post.text !== "string") return;

    firehoseState.lastEventAt = new Date().toISOString();

    try {
      const keywords = await getActiveKeywords();
      const lower = post.text.toLowerCase();
      const matchingFeeds = new Set<string>();

      for (const [keyword, feedNames] of keywords) {
        if (lower.includes(keyword)) {
          for (const f of feedNames) matchingFeeds.add(f);
        }
      }

      if (matchingFeeds.size === 0) return;

      const uri = `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`;
      const algoTags = Array.from(matchingFeeds).join(",");

      await db
        .insert(indexedPostsTable)
        .values({
          uri,
          cid: event.commit.cid,
          author: event.did,
          text: post.text,
          algoTags,
          indexedAt: event.time_us
            ? new Date(Number(event.time_us) / 1000)
            : new Date(),
        })
        .onConflictDoUpdate({
          target: indexedPostsTable.uri,
          set: {
            algoTags: sql`excluded.algo_tags`,
            indexedAt: sql`excluded.indexed_at`,
          },
        });

      firehoseState.postsIndexedTotal++;

      logger.debug({ uri, feeds: algoTags }, "[Firehose] Indexed post");
    } catch (err) {
      logger.error({ err }, "[Firehose] Error indexing post");
    }
  });

  jetstream.onDelete("app.bsky.feed.post", async (event) => {
    const uri = `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`;
    try {
      await db.delete(indexedPostsTable).where(eq(indexedPostsTable.uri, uri));
    } catch (err) {
      logger.error({ err }, "[Firehose] Error deleting post");
    }
  });

  jetstream.start();
  return jetstream;
}

export function getFirehose() {
  return jetstream;
}
