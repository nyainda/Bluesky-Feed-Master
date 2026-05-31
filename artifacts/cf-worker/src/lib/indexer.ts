import { eq, sql } from "drizzle-orm";
import { createDb, feedsTable, keywordsTable, indexedPostsTable } from "../db";
import { markAuthorDirty } from "./author-scoring";
import type { Env } from "../index";

/**
 * Cron-based post indexer — runs every 3 minutes via Cloudflare Cron Triggers.
 * Replaces the persistent firehose WebSocket. Uses Bluesky's searchPosts API
 * to find recent posts matching each feed's keywords and upserts them into D1.
 */
export async function runIndexer(env: Env): Promise<void> {
  const db = createDb(env.DB);

  const feeds = await db
    .select()
    .from(feedsTable)
    .where(eq(feedsTable.isActive, true));

  if (feeds.length === 0) {
    console.log("[indexer] No active feeds — skipping.");
    return;
  }

  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: env.BLUESKY_HANDLE,
    password: env.BLUESKY_APP_PASSWORD,
  });

  let totalIndexed = 0;
  let totalSkipped = 0;
  let totalKeywords = 0;

  for (const feed of feeds) {
    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.feedId, feed.id));

    if (keywords.length === 0) continue;
    totalKeywords += keywords.length;

    for (const kw of keywords) {
      try {
        // Search both plain text and hashtag variations for better coverage
        const [plainResult, hashtagResult] = await Promise.allSettled([
          agent.app.bsky.feed.searchPosts({
            q: kw.keyword,
            limit: 25,
            sort: "latest",
          }),
          agent.app.bsky.feed.searchPosts({
            q: `#${kw.keyword}`,
            limit: 25,
            sort: "latest",
          }),
        ]);

        const posts = [
          ...(plainResult.status === "fulfilled" ? plainResult.value.data.posts : []),
          ...(hashtagResult.status === "fulfilled" ? hashtagResult.value.data.posts : []),
        ];

        // Deduplicate by URI
        const uniquePosts = [...new Map(posts.map((p) => [p.uri, p])).values()];

        const algoTag = feed.recordName;

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
            totalIndexed++;
          } catch (insertErr) {
            console.error(`[indexer] Insert failed for ${post.uri}:`, insertErr);
            totalSkipped++;
          }
        }
      } catch (searchErr) {
        console.error(`[indexer] Search failed for keyword "${kw.keyword}":`, searchErr);
      }
    }
  }

  console.log(
    `[indexer] Done — ${totalIndexed} posts indexed, ${totalSkipped} skipped. ` +
      `${feeds.length} feeds processed, ${totalKeywords} keywords total.`,
  );
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
