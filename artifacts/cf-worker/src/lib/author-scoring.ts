import { and, eq, lte, sql } from "drizzle-orm";
import { authorsTable, authorScoresTable, createDb, indexedPostsTable } from "../db";
import type { Env } from "../index";

import { computeAuthorScore } from "./scoring-formula";

const FORMULA_VERSION = "v1";
const RECALC_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_RECALC_ATTEMPTS = 20;

/**
 * Mark a single author as needing score recalculation.
 * Prefer batchMarkAuthorsDirty() when marking multiple authors in one pass
 * to avoid one D1 write per post.
 */
export async function markAuthorDirty(env: Env, did: string): Promise<void> {
  await batchMarkAuthorsDirty(env, [did]);
}

/**
 * Mark multiple authors dirty in a single D1 batch — one statement per unique
 * DID, submitted together. Replaces N individual markAuthorDirty() calls that
 * previously fired one D1 write per indexed post.
 */
export async function batchMarkAuthorsDirty(env: Env, dids: string[]): Promise<void> {
  if (dids.length === 0) return;
  const uniqueDids = [...new Set(dids)];
  const nowIso = new Date().toISOString();

  await env.DB.batch(
    uniqueDids.map(did =>
      env.DB
        .prepare(
          `INSERT INTO authors (did, needs_recalc, recalc_attempts, next_recalc_at, updated_at)
           VALUES (?, 1, 0, ?, ?)
           ON CONFLICT(did) DO UPDATE SET
             needs_recalc = 1,
             next_recalc_at = ?,
             updated_at = ?`
        )
        .bind(did, nowIso, nowIso, nowIso, nowIso)
    )
  );
}

/**
 * Recalculate scores for dirty authors.
 * batchSize reduced from 50 → 20 to stay within D1 free-tier write limits
 * (each author costs 2 writes: upsert author_scores + update authors).
 * 20 × 2 × 480 ticks/day = 19,200 writes/day.
 */
export async function runAuthorScoring(env: Env, batchSize = 20): Promise<void> {
  const db = createDb(env.DB);
  const nowIso = new Date().toISOString();

  const dirtyAuthors = await db
    .select({ did: authorsTable.did, recalcAttempts: authorsTable.recalcAttempts })
    .from(authorsTable)
    .where(and(eq(authorsTable.needsRecalc, true), lte(authorsTable.nextRecalcAt, nowIso)))
    .limit(batchSize);

  if (dirtyAuthors.length === 0) {
    console.log("[author-scoring] No dirty authors to process.");
    return;
  }

  const results = await Promise.allSettled(
    dirtyAuthors.map(async ({ did, recalcAttempts }) => {
      if (recalcAttempts >= MAX_RECALC_ATTEMPTS) {
        await db
          .update(authorsTable)
          .set({ needsRecalc: false, updatedAt: nowIso })
          .where(eq(authorsTable.did, did));
        console.error("[author-scoring] Max retry attempts reached", { did, recalcAttempts });
        return;
      }

      const [aggregate] = await db
        .select({
          postCount: sql<number>`cast(count(*) as integer)`,
          totalLikes: sql<number>`cast(coalesce(sum(${indexedPostsTable.likes}),0) as integer)`,
          totalReposts: sql<number>`cast(coalesce(sum(${indexedPostsTable.reposts}),0) as integer)`,
          totalReplies: sql<number>`cast(coalesce(sum(${indexedPostsTable.replies}),0) as integer)`,
        })
        .from(indexedPostsTable)
        .where(eq(indexedPostsTable.author, did));

      const postCount = Number(aggregate?.postCount ?? 0);
      const totalLikes = Number(aggregate?.totalLikes ?? 0);
      const totalReposts = Number(aggregate?.totalReposts ?? 0);
      const totalReplies = Number(aggregate?.totalReplies ?? 0);
      const score = Math.round(computeAuthorScore({ postCount, totalLikes, totalReposts, totalReplies }));

      await db
        .insert(authorScoresTable)
        .values({
          did,
          score,
          postCount,
          totalLikes,
          totalReposts,
          totalReplies,
          formulaVersion: FORMULA_VERSION,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: authorScoresTable.did,
          set: { score, postCount, totalLikes, totalReposts, totalReplies, formulaVersion: FORMULA_VERSION, updatedAt: nowIso },
        });

      await db
        .update(authorsTable)
        .set({ needsRecalc: false, recalcAttempts: 0, lastScoredAt: nowIso, updatedAt: nowIso })
        .where(eq(authorsTable.did, did));

      console.log("[author-scoring] author_score_updated", { did, score, postCount });
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      const did = dirtyAuthors[i]?.did;
      if (!did) continue;
      const nextAttemptAt = new Date(Date.now() + RECALC_COOLDOWN_MS).toISOString();
      await db
        .update(authorsTable)
        .set({
          recalcAttempts: sql`${authorsTable.recalcAttempts} + 1`,
          nextRecalcAt: nextAttemptAt,
          updatedAt: nowIso,
        })
        .where(eq(authorsTable.did, did));

      console.error("[author-scoring] Failed for author", did, result.reason);
    }
  }
}
