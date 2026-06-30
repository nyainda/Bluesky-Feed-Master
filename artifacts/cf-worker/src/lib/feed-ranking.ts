import { desc, eq, sql } from "drizzle-orm";
import { authorScoresTable, createDb, feedRankedPostsTable, feedsTable, indexedPostsTable } from "../db";
import type { Env } from "../index";
import { computeQualityScore, computeRecencyDecay } from "./quality-layer";

const RANK_WEIGHTS = {
  author: 0.4,
  engagementVelocity: 0.3,
  quality: 0.2,
  recency: 0.1,
} as const;

function safeFinite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

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
      .where(sql`instr(',' || ${indexedPostsTable.algoTags} || ',', ',' || ${feed.recordName} || ',') > 0`)
      .orderBy(desc(indexedPostsTable.indexedAt))
      .limit(candidateLimit);

    const scored = candidates
      .map(({ post, authorScore }) => {
        const ageMs = Date.now() - new Date(post.indexedAt).getTime();
        const ageMinutes = Math.max(1, ageMs / 60000);
        const ageHours = ageMinutes / 60;

        const qualityScore = safeFinite(
          computeQualityScore({
            likes: post.likes,
            reposts: post.reposts,
            replies: post.replies,
            quotes: post.quotes,
            postAgeMinutes: ageMinutes,
            text: post.text,
          }),
        );

        // Exponential recency decay — delegated to quality-layer for a single source of truth
        const recency = safeFinite(computeRecencyDecay(ageMinutes));

        const rawEngagement = post.likes + post.reposts * 2 + post.replies * 3 + post.quotes * 2;
        const rawVelocity = rawEngagement / ageMinutes;
        const engagementVelocity = safeFinite(Math.tanh(rawVelocity / 5));

        // Trending boost: posts < 3h old with high velocity get a +20% score bonus
        // This surfaces viral content before it ages out of the recency window
        const isTrending = ageHours < 3 && rawVelocity > 2;
        const trendingMultiplier = isTrending ? 1.2 : 1.0;

        const normalizedAuthor = safeFinite(Math.min(1, (authorScore ?? 0) / 1000));

        const baseScore = safeFinite(
          RANK_WEIGHTS.author * normalizedAuthor +
            RANK_WEIGHTS.engagementVelocity * engagementVelocity +
            RANK_WEIGHTS.quality * qualityScore +
            RANK_WEIGHTS.recency * recency,
        );
        const finalScore = safeFinite(baseScore * trendingMultiplier);

        return { post, finalScore, qualityScore };
      })
      // Primary sort: finalScore desc; tiebreaker: indexedAt desc (most recent wins)
      .sort((a, b) => {
        const diff = b.finalScore - a.finalScore;
        if (Math.abs(diff) > 1e-10) return diff;
        return new Date(b.post.indexedAt).getTime() - new Date(a.post.indexedAt).getTime();
      })
      .map((row, i) => ({ ...row, rank: i + 1 }));

    await db.delete(feedRankedPostsTable).where(eq(feedRankedPostsTable.feedId, feed.id));

    for (const row of scored) {
      // Skip rows with non-finite scores to prevent DB corruption
      if (!Number.isFinite(row.finalScore)) continue;
      await db.insert(feedRankedPostsTable).values({
        feedId: feed.id,
        postUri: row.post.uri,
        rank: row.rank,
        finalScore: row.finalScore,
        qualityScore: row.qualityScore,
        computedAt: new Date().toISOString(),
      });
    }

    console.log(`[feed-ranking] Feed "${feed.recordName}" — ${scored.length} ranked posts written.`);
  }
}
