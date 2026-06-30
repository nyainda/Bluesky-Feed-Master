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
 * Search-API indexer — supplemental backfill pass.
 *
 * In cron mode (default): staggered round-robin — indexes ONE feed per tick so
 * each feed gets fresh search results every (feeds.length × 3) minutes without
 * hammering the rate limit. Pass maxFeeds=Infinity for manual full-index.
 *
 * Jetstream (jetstream.ts) is the primary real-time indexer; this catches posts
 * that predate the Jetstream cursor or fall outside its filter window.
 */
export async function runIndexer(env: Env, options?: { maxFeeds?: number }): Promise<FeedIndexResult[]> {
  const db = createDb(env.DB);

  // ── Phase 1: Read all config from D1 BEFORE any external HTTP calls ──────────
  const allActiveFeeds = await db
    .select()
    .from(feedsTable)
    .where(eq(feedsTable.isActive, true));

  if (allActiveFeeds.length === 0) {
    console.log("[indexer] No active feeds — skipping.");
    return [];
  }

  const maxFeeds = options?.maxFeeds ?? 1; // default: 1 feed per tick (staggered)

  // Round-robin: pick which feed(s) to index this tick
  let feeds = allActiveFeeds;
  if (maxFeeds < allActiveFeeds.length) {
    const idxRow = await env.DB
      .prepare("SELECT value FROM cron_settings WHERE key = 'indexer_feed_cursor'")
      .first<{ value: string }>();
    const currentIdx = parseInt(idxRow?.value ?? "0", 10) || 0;
    const nextIdx = (currentIdx + maxFeeds) % allActiveFeeds.length;

    feeds = allActiveFeeds.slice(currentIdx, currentIdx + maxFeeds);
    if (feeds.length < maxFeeds) {
      // Wrap around
      feeds = [...feeds, ...allActiveFeeds.slice(0, maxFeeds - feeds.length)];
    }

    // Advance cursor for next tick
    await env.DB
      .prepare(
        "INSERT INTO cron_settings (key, value) VALUES ('indexer_feed_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
      )
      .bind(String(nextIdx))
      .run()
      .catch(() => {});

    console.log(`[indexer] Staggered — indexing feed ${currentIdx + 1}/${allActiveFeeds.length}: "${feeds.map(f => f.recordName).join(", ")}"`);
  }

  // Load all keywords across all active feeds in a single D1 query
  const allKeywordRows = await db.select().from(keywordsTable);
  const keywordsByFeed = new Map<number, string[]>();
  for (const row of allKeywordRows) {
    if (!keywordsByFeed.has(row.feedId)) keywordsByFeed.set(row.feedId, []);
    keywordsByFeed.get(row.feedId)!.push(row.keyword);
  }

  // ── Phase 2: Login to Bluesky (external HTTP) ────────────────────────────────
  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: env.BLUESKY_HANDLE,
    password: env.BLUESKY_APP_PASSWORD,
  });

  // ── Phase 3: Search + insert, one feed at a time ─────────────────────────────
  const CONCURRENCY = 2;        // 2 keywords × 2 searches = 4 concurrent API calls per batch (safe under rate limit)
  const BATCH_DELAY_MS = 600;  // 600ms between keyword batches — prevents search API rate limiting on later feeds
  const FEED_DELAY_MS = 1500;  // 1.5s between feeds — ensures every feed gets fresh quota

  const allResults: FeedIndexResult[] = [];

  for (let feedIdx = 0; feedIdx < feeds.length; feedIdx++) {
    const feed = feeds[feedIdx];
    const keywords = keywordsByFeed.get(feed.id) ?? [];

    if (keywords.length === 0) {
      console.log(`[indexer] Feed "${feed.recordName}" has no keywords — skipping.`);
      allResults.push({ feed: feed.recordName, keywords: 0, indexed: 0, skipped: 0, errors: [] });
      continue;
    }

    let feedIndexed = 0;
    let feedSkipped = 0;
    const feedErrors: string[] = [];
    const algoTag = feed.recordName;

    for (let i = 0; i < keywords.length; i += CONCURRENCY) {
      const batch = keywords.slice(i, i + CONCURRENCY);

      await Promise.allSettled(
        batch.map(async (keyword) => {
          try {
            const [plainResult, hashtagResult] = await Promise.allSettled([
              agent.app.bsky.feed.searchPosts({ q: keyword, limit: 25, sort: "latest" }),
              agent.app.bsky.feed.searchPosts({ q: `#${keyword}`, limit: 25, sort: "latest" }),
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

      if (i + CONCURRENCY < keywords.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    console.log(
      `[indexer] Feed "${feed.recordName}" — ${feedIndexed} indexed, ${feedSkipped} skipped, ${feedErrors.length} errors.`,
    );
    allResults.push({
      feed: feed.recordName,
      keywords: keywords.length,
      indexed: feedIndexed,
      skipped: feedSkipped,
      errors: feedErrors,
    });

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
