import { and, eq, lte, sql } from "drizzle-orm";
import { authorsTable, authorScoresTable, createDb, indexedPostsTable } from "../db";
import type { Env } from "../index";

import { computeAuthorScore } from "./scoring-formula";

const FORMULA_VERSION = "v1";
const RECALC_COOLDOWN_MS = 2 * 60 * 1000;

export async function markAuthorDirty(env: Env, did: string): Promise<void> {
  const db = createDb(env.DB);
  const nowIso = new Date().toISOString();

  await db
    .insert(authorsTable)
    .values({
      did,
      needsRecalc: true,
      recalcAttempts: 0,
      nextRecalcAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: authorsTable.did,
      set: {
        needsRecalc: true,
        nextRecalcAt: nowIso,
        updatedAt: nowIso,
      },
    });
}

export async function runAuthorScoring(env: Env, batchSize = 200): Promise<void> {
  const db = createDb(env.DB);
  const nowIso = new Date().toISOString();

  const dirtyAuthors = await db
    .select({ did: authorsTable.did })
    .from(authorsTable)
    .where(and(eq(authorsTable.needsRecalc, true), lte(authorsTable.nextRecalcAt, nowIso)))
    .limit(batchSize);

  if (dirtyAuthors.length === 0) {
    console.log("[author-scoring] No dirty authors to process.");
    return;
  }

  for (const { did } of dirtyAuthors) {
    try {
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
      const score = computeAuthorScore({ postCount, totalLikes, totalReposts, totalReplies });

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
    } catch (err) {
      const nextAttemptAt = new Date(Date.now() + RECALC_COOLDOWN_MS).toISOString();
      await db
        .update(authorsTable)
        .set({
          recalcAttempts: sql`${authorsTable.recalcAttempts} + 1`,
          nextRecalcAt: nextAttemptAt,
          updatedAt: nowIso,
        })
        .where(eq(authorsTable.did, did));

      console.error("[author-scoring] Failed for author", did, err);
    }
  }
}
