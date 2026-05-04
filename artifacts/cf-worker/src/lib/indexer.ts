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
  const agent = new AtpAgent({ service: "https://public.api.bsky.app" });

  let totalIndexed = 0;
  let totalSkipped = 0;

  for (const feed of feeds) {
    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.feedId, feed.id));

    if (keywords.length === 0) continue;

    for (const kw of keywords) {
      try {
        const result = await agent.app.bsky.feed.searchPosts({
          q: kw.keyword,
          limit: 25,
          sort: "latest",
        });

        for (const post of result.data.posts) {
          const postText = (post.record as { text?: string }).text ?? "";

          // Build the algo_tags — append this feed's record name if not already present
          const algoTag = feed.recordName;

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
                  // Append feed tag if the post matches multiple feeds
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
      `Feeds: ${feeds.length}, Keywords total: ${feeds.reduce(() => 0, 0)}`,
  );
}
