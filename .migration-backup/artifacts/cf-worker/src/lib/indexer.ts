import { eq, sql } from "drizzle-orm";
import { createDb, feedsTable, keywordsTable, indexedPostsTable } from "../db";
import { markAuthorDirty } from "./author-scoring";
import type { Env } from "../index";

export type FeedIndexResult = {
  feed: string;
  keywords: number;
  indexed: number;
  skipped: number;
  errors: string[];
};

/**
 * Cron-based post indexer — runs every 3 minutes via Cloudflare Cron Triggers.
 *
 * Key design decisions:
 * - Processes feeds ONE AT A TIME with a 1.5-second pause between feeds.
 *   This prevents the Bluesky search rate limit (~50 req/min) from exhausting
 *   all budget on early feeds and leaving later feeds with 0 results.
 * - Within each feed, keywords are processed in batches of 4 (8 API calls)
 *   with a 400ms pause between batches.
 * - Both plain-text and hashtag searches run in parallel per keyword.
 * - All errors are captured and returned so the trigger endpoint can surface them.
 */
export async function runIndexer(env: Env): Promise<FeedIndexResult[]> {
  const db = createDb(env.DB);

  const feeds = await db
    .select()
    .from(feedsTable)
    .where(eq(feedsTable.isActive, true));

  if (feeds.length === 0) {
    console.log("[indexer] No active feeds — skipping.");
    return [];
  }

  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: env.BLUESKY_HANDLE,
    password: env.BLUESKY_APP_PASSWORD,
  });

  const CONCURRENCY = 4;      // 4 keywords × 2 searches = 8 concurrent API calls per batch
  const BATCH_DELAY_MS = 400; // pause between keyword batches within a feed
  const FEED_DELAY_MS = 1500; // pause between feeds — key to avoiding rate limit exhaustion

  const allResults: FeedIndexResult[] = [];

  for (let feedIdx = 0; feedIdx < feeds.length; feedIdx++) {
    const feed = feeds[feedIdx];

    const keywordRows = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.feedId, feed.id));

    const keywords = keywordRows.map(k => k.keyword);

    if (keywords.length === 0) {
      console.log(`[indexer] Feed "${feed.recordName}" has no keywords — skipping.`);
      allResults.push({ feed: feed.recordName, keywords: 0, indexed: 0, skipped: 0, errors: [] });
      continue;
    }

    let feedIndexed = 0;
    let feedSkipped = 0;
    const feedErrors: string[] = [];
    const algoTag = feed.recordName;

    // Process this feed's keywords in small batches with delays
    for (let i = 0; i < keywords.length; i += CONCURRENCY) {
      const batch = keywords.slice(i, i + CONCURRENCY);

      await Promise.allSettled(
        batch.map(async (keyword) => {
          try {
            const [plainResult, hashtagResult] = await Promise.allSettled([
              agent.app.bsky.feed.searchPosts({ q: keyword, limit: 100, sort: "latest" }),
              agent.app.bsky.feed.searchPosts({ q: `#${keyword}`, limit: 100, sort: "latest" }),
            ]);

            if (plainResult.status === "rejected") {
              const msg = plainResult.reason instanceof Error ? plainResult.reason.message : String(plainResult.reason);
              feedErrors.push(`search("${keyword}"): ${msg}`);
            }
            if (hashtagResult.status === "rejected") {
              const msg = hashtagResult.reason instanceof Error ? hashtagResult.reason.message : String(hashtagResult.reason);
              feedErrors.push(`search("#${keyword}"): ${msg}`);
            }

            const posts = [
              ...(plainResult.status === "fulfilled" ? plainResult.value.data.posts : []),
              ...(hashtagResult.status === "fulfilled" ? hashtagResult.value.data.posts : []),
            ];

            // Deduplicate by URI
            const uniquePosts = [...new Map(posts.map((p) => [p.uri, p])).values()];

            for (const post of uniquePosts) {
              const postText = (post.record as { text?: string }).text ?? "";
              try {
                await db
                  .insert(indexedPostsTable)
                  .values({
                    uri: post.uri,
                    cid: post.cid,
                    author: post.author.did,
                    text: postText,
                    algoTags: algoTag,
                    indexedAt: new Date().toISOString(),
                    likes: post.likeCount ?? 0,
                    reposts: post.repostCount ?? 0,
                    replies: post.replyCount ?? 0,
                    quotes: post.quoteCount ?? 0,
                  })
                  .onConflictDoUpdate({
                    target: indexedPostsTable.uri,
                    set: {
                      algoTags: sql`CASE
                        WHEN algo_tags LIKE ${"%" + algoTag + "%"}
                        THEN algo_tags
                        ELSE algo_tags || ',' || ${algoTag}
                      END`,
                      likes: post.likeCount ?? 0,
                      reposts: post.repostCount ?? 0,
                      replies: post.replyCount ?? 0,
                      quotes: post.quoteCount ?? 0,
                      engagementSyncedAt: new Date().toISOString(),
                    },
                  });
                await markAuthorDirty(env, post.author.did);
                feedIndexed++;
              } catch (insertErr) {
                const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
                feedErrors.push(`insert(${post.uri.slice(-12)}): ${msg}`);
                feedSkipped++;
              }
            }
          } catch (searchErr) {
            const msg = searchErr instanceof Error ? searchErr.message : String(searchErr);
            console.error(`[indexer] Search failed — keyword "${keyword}" (feed: ${feed.recordName}):`, searchErr);
            feedErrors.push(`search("${keyword}"): ${msg}`);
          }
        }),
      );

      // Pause between keyword batches within this feed
      if (i + CONCURRENCY < keywords.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    console.log(
      `[indexer] Feed "${feed.recordName}" — ${feedIndexed} indexed, ${feedSkipped} skipped, ${feedErrors.length} errors.`,
    );
    allResults.push({ feed: feed.recordName, keywords: keywords.length, indexed: feedIndexed, skipped: feedSkipped, errors: feedErrors });

    // Pause between feeds to let the Bluesky rate-limit window reset.
    // Without this, feeds beyond the 2nd–3rd get zero results silently.
    if (feedIdx < feeds.length - 1) {
      await new Promise(r => setTimeout(r, FEED_DELAY_MS));
    }
  }

  const totalIndexed = allResults.reduce((s, r) => s + r.indexed, 0);
  const totalErrors = allResults.reduce((s, r) => s + r.errors.length, 0);
  console.log(
    `[indexer] Done — ${totalIndexed} posts across ${feeds.length} feeds, ${totalErrors} total errors.`,
  );

  return allResults;
}

/**
 * Daily cleanup — deletes posts older than 7 days to prevent D1 filling up.
 */
export async function runCleanup(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const result = await db.run(
    sql`DELETE FROM indexed_posts WHERE indexed_at < datetime('now', '-7 days')`,
  );
  console.log(`[cleanup] Deleted old posts. Changes: ${result.meta?.changes ?? 0}`);
}
