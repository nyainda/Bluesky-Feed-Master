import { desc, eq, sql } from "drizzle-orm";
import { authorScoresTable, createDb, feedRankedPostsTable, feedsTable, indexedPostsTable } from "../db";
import type { Env } from "../index";
import { computeQualityScore, computeRecencyDecay } from "./quality-layer";

const RANK_WEIGHTS = {
  // Recency boosted to 35% — fresh posts must surface above stale high-scorers.
  // Author reduced to 25% — popular authors shouldn't dominate over new content.
  // Quality reduced to 10% — velocity already captures engagement quality.
  author: 0.25,
  engagementVelocity: 0.30,
  quality: 0.10,
  recency: 0.35,
} as const;

/**
 * Hard age gate: only consider posts indexed within the last 72 hours.
 * Posts older than this are dropped from the candidate pool regardless of score,
 * preventing high-engagement older posts from permanently occupying top ranks.
 */
const CANDIDATE_MAX_AGE_HOURS = 72;

/**
 * Minimum gap between ranking runs — 14 minutes keeps us to ≤103 runs/day
 * at the 3-min cron cadence, vs 480 runs/day previously.
 * This is the single biggest D1 write reduction (saves ~380K writes/day).
 */
const RANKING_COOLDOWN_MS = 14 * 60 * 1_000;

/**
 * Candidates per feed — reduced from 200 to 50.
 * Each candidate produces one INSERT into feed_ranked_posts after the DELETE.
 * 50 rows × 5 feeds × ~103 runs/day ≈ 25,750 writes/day (was ~482,400).
 */
const CANDIDATE_LIMIT = 50;

function safeFinite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

export async function precomputeFeedRankings(env: Env): Promise<void> {
  // ── Rate-limit: skip if run within the cooldown window ───────────────────────
  const lastRunRow = await env.DB
    .prepare("SELECT value FROM cron_settings WHERE key = 'last_ranking_run'")
    .first<{ value: string }>();

  if (lastRunRow?.value) {
    const ageMs = Date.now() - new Date(lastRunRow.value).getTime();
    if (ageMs < RANKING_COOLDOWN_MS) {
      console.log(`[feed-ranking] Skipping — ran ${Math.round(ageMs / 60_000)}min ago (cooldown: ${RANKING_COOLDOWN_MS / 60_000}min)`);
      return;
    }
  }

  // Stamp the run time immediately so concurrent ticks don't race
  await env.DB
    .prepare(
      "INSERT INTO cron_settings (key, value) VALUES ('last_ranking_run', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')"
    )
    .run()
    .catch(() => {});

  const db = createDb(env.DB);
  const feeds = await db.select().from(feedsTable).where(eq(feedsTable.isActive, true));

  for (const feed of feeds) {
    // Hard age gate: drop posts older than CANDIDATE_MAX_AGE_HOURS from the pool.
    // This prevents high-engagement posts from weeks ago from permanently
    // outscoring fresh content even when their recency decay approaches zero.
    const cutoffIso = new Date(Date.now() - CANDIDATE_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

    const candidates = await db
      .select({
        post: indexedPostsTable,
        authorScore: authorScoresTable.score,
      })
      .from(indexedPostsTable)
      .leftJoin(authorScoresTable, eq(authorScoresTable.did, indexedPostsTable.author))
      .where(
        sql`instr(',' || ${indexedPostsTable.algoTags} || ',', ',' || ${feed.recordName} || ',') > 0 AND ${indexedPostsTable.indexedAt} >= ${cutoffIso}`
      )
      .orderBy(desc(indexedPostsTable.indexedAt))
      .limit(CANDIDATE_LIMIT);

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

        const recency = safeFinite(computeRecencyDecay(ageMinutes));

        const rawEngagement = post.likes + post.reposts * 2 + post.replies * 3 + post.quotes * 2;
        const rawVelocity = rawEngagement / ageMinutes;
        const engagementVelocity = safeFinite(Math.tanh(rawVelocity / 5));

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
      .sort((a, b) => {
        const diff = b.finalScore - a.finalScore;
        if (Math.abs(diff) > 1e-10) return diff;
        return new Date(b.post.indexedAt).getTime() - new Date(a.post.indexedAt).getTime();
      })
      .map((row, i) => ({ ...row, rank: i + 1 }));

    const validRows = scored.filter(row => Number.isFinite(row.finalScore));

    // DELETE old rankings
    await db.delete(feedRankedPostsTable).where(eq(feedRankedPostsTable.feedId, feed.id));

    // D1 has a 100 bound-variable limit per statement.
    // Each row binds 6 params (id is a null literal, not bound).
    // 15 rows × 6 params = 90 vars — safely under the limit.
    if (validRows.length > 0) {
      const computedAt = new Date().toISOString();
      const CHUNK = 15;
      for (let i = 0; i < validRows.length; i += CHUNK) {
        await db.insert(feedRankedPostsTable).values(
          validRows.slice(i, i + CHUNK).map(row => ({
            feedId: feed.id,
            postUri: row.post.uri,
            rank: row.rank,
            finalScore: row.finalScore,
            qualityScore: row.qualityScore,
            computedAt,
          }))
        );
      }
    }

    console.log(`[feed-ranking] Feed "${feed.recordName}" — ${validRows.length} ranked posts written.`);
  }
}
