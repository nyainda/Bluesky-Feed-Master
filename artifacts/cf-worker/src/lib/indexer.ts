import { eq, sql } from "drizzle-orm";
import { createDb, feedsTable, keywordsTable, indexedPostsTable } from "../db";
import { markAuthorDirty } from "./author-scoring";
import type { Env } from "../index";

/**
 * Cron-based post indexer — runs every 3 minutes via Cloudflare Cron Triggers.
 * Uses Bluesky's searchPosts API (plain text + hashtag) to find posts for each
 * feed keyword, then upserts them into D1 with the feed's recordName in algoTags.
 *
 * Processes all (feed × keyword) tasks concurrently in batches of 8 to avoid
 * the sequential-serial timeout that killed feeds beyond the 2nd or 3rd.
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

  // ── Collect all (feed, keyword) tasks upfront ──────────────────────────────
  type Task = { feed: (typeof feeds)[0]; keyword: string };
  const tasks: Task[] = [];

  for (const feed of feeds) {
    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.feedId, feed.id));
    for (const kw of keywords) {
      tasks.push({ feed, keyword: kw.keyword });
    }
  }

  if (tasks.length === 0) {
    console.log("[indexer] No keywords configured — skipping.");
    return;
  }

  // ── Process tasks concurrently in batches of 8 ─────────────────────────────
  // Each task fires 2 searchPosts calls (plain + hashtag) in parallel.
  // 8 tasks × 2 calls = 16 concurrent API requests per batch.
  // With ~90 tasks total this takes ~6 batches × ~500ms = ~3 seconds
  // instead of 90 sequential pairs × ~350ms = 31 seconds (which timed out).
  const CONCURRENCY = 8;
  let totalIndexed = 0;
  let totalSkipped = 0;

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);

    await Promise.allSettled(
      batch.map(async ({ feed, keyword }) => {
        try {
          const [plainResult, hashtagResult] = await Promise.allSettled([
            agent.app.bsky.feed.searchPosts({ q: keyword, limit: 25, sort: "latest" }),
            agent.app.bsky.feed.searchPosts({ q: `#${keyword}`, limit: 25, sort: "latest" }),
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
            } catch {
              totalSkipped++;
            }
          }
        } catch (searchErr) {
          console.error(`[indexer] Search failed for keyword "${keyword}" (feed: ${feed.recordName}):`, searchErr);
        }
      }),
    );
  }

  console.log(
    `[indexer] Done — ${totalIndexed} posts indexed, ${totalSkipped} skipped. ` +
      `${feeds.length} feeds, ${tasks.length} keyword tasks processed.`,
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
