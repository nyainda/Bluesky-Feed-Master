import { and, desc, eq, like, sql } from "drizzle-orm";
import { authorScoresTable, createDb, feedRankedPostsTable, feedsTable, indexedPostsTable } from "../db";
import type { Env } from "../index";
import { computeQualityScore, computeRecencyDecay } from "./quality-layer";

const RANK_WEIGHTS = {
  author: 0.4,
  engagementVelocity: 0.3,
  quality: 0.2,
  recency: 0.1,
} as const;

export async function precomputeFeedRankings(env: Env, candidateLimit = 200): Promise<void> {
  const db = createDb(env.DB);
  const feeds = await db.select().from(feedsTable).where(eq(feedsTable.isActive, true));

  for (const feed of feeds) {
    const candidates = await db
      .select({
        post: indexedPostsTable,
        authorScore: authorScoresTable.score,
      })
      .from(indexedPostsTable)
      .leftJoin(authorScoresTable, eq(authorScoresTable.did, indexedPostsTable.author))
      .where(like(indexedPostsTable.algoTags, `%${feed.recordName}%`))
      .orderBy(desc(indexedPostsTable.indexedAt))
      .limit(candidateLimit);

    let rank = 1;
    const scored = candidates
      .map(({ post, authorScore }) => {
        const ageMinutes = (Date.now() - new Date(post.indexedAt).getTime()) / 60000;
        const qualityScore = computeQualityScore({ likes: post.likes, reposts: post.reposts, replies: post.replies, quotes: post.quotes, postAgeMinutes: ageMinutes, text: post.text });
        const recency = computeRecencyDecay(ageMinutes);
        const engagementVelocity = (post.likes + post.reposts * 2 + post.replies * 3) / Math.max(1, ageMinutes);
        const normalizedAuthor = Math.min(1, (authorScore ?? 0) / 1000);
        const finalScore =
          RANK_WEIGHTS.author * normalizedAuthor +
          RANK_WEIGHTS.engagementVelocity * Math.tanh(engagementVelocity / 5) +
          RANK_WEIGHTS.quality * qualityScore +
          RANK_WEIGHTS.recency * recency;
        return { post, finalScore, qualityScore, rank: rank++ };
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .map((row, i) => ({ ...row, rank: i + 1 }));

    for (const row of scored) {
      await db
        .insert(feedRankedPostsTable)
        .values({
          feedId: feed.id,
          postUri: row.post.uri,
          rank: row.rank,
          finalScore: row.finalScore,
          qualityScore: row.qualityScore,
          computedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: [feedRankedPostsTable.feedId, feedRankedPostsTable.postUri],
          set: {
            rank: row.rank,
            finalScore: row.finalScore,
            qualityScore: row.qualityScore,
            computedAt: sql`excluded.computed_at`,
          },
        });
    }
  }
}
