import type { Env } from "../index";

const TABLE = "unfollow_scheduled_queue";
// 100 unfollows per 3-min cron = ~2,000/hour.
// Well within Bluesky's rate limit (600/min). 1k queued = ~30 min to drain.
// At this pace: 5k = 2.5h, 10k = 5h, 51k = ~25h. Aggressive but safe.
const BATCH_PER_CRON = 100;
const DELAY_MS = 150;          // 150ms between each deleteFollow — 100 × 150ms = 15s overhead per tick

export async function ensureScheduledUnfollowTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      did          TEXT NOT NULL UNIQUE,
      follow_uri   TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      queued_at    TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )`,
  ).run();
}

export async function enqueueScheduledUnfollowItems(
  env: Env,
  items: Array<{ did: string; followUri?: string | null }>,
): Promise<{ enqueued: number; skipped: number }> {
  await ensureScheduledUnfollowTable(env);

  let enqueued = 0;
  let skipped = 0;
  const CHUNK = 100;

  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const stmts = chunk.map((item) =>
      // ON CONFLICT: if DID already exists and is 'done'/'failed', re-queue it. If still 'pending', leave alone.
      env.DB.prepare(
        `INSERT INTO ${TABLE} (did, follow_uri) VALUES (?, ?)
         ON CONFLICT(did) DO UPDATE SET
           follow_uri   = excluded.follow_uri,
           status       = 'pending',
           queued_at    = datetime('now'),
           processed_at = NULL
         WHERE status != 'pending'`,
      ).bind(item.did, item.followUri ?? null),
    );
    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if ((r.meta as { changes?: number })?.changes ?? 0 > 0) enqueued++;
      else skipped++;
    }
  }

  return { enqueued, skipped };
}

export async function getScheduledUnfollowStatus(env: Env): Promise<{
  pending: number;
  done: number;
  failed: number;
  total: number;
  estimatedMinutesLeft: number;
}> {
  try {
    await ensureScheduledUnfollowTable(env);
    const rows = await env.DB.prepare(
      `SELECT status, COUNT(*) as cnt FROM ${TABLE} GROUP BY status`,
    ).all<{ status: string; cnt: number }>();

    const counts: Record<string, number> = { pending: 0, done: 0, failed: 0 };
    for (const row of rows.results) {
      if (row.status in counts) counts[row.status] = Number(row.cnt);
    }
    const total = counts.pending + counts.done + counts.failed;
    const estimatedMinutesLeft = Math.ceil((counts.pending / BATCH_PER_CRON) * 3);
    return {
      pending: counts.pending,
      done: counts.done,
      failed: counts.failed,
      total,
      estimatedMinutesLeft,
    };
  } catch {
    return { pending: 0, done: 0, failed: 0, total: 0, estimatedMinutesLeft: 0 };
  }
}

export async function clearScheduledUnfollowQueue(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM ${TABLE}`).run();
  } catch {}
}

/**
 * Called by the every-3-minute cron. Processes up to BATCH_PER_CRON pending items.
 * Rate: 100 items × 150ms delay = ~15s of delays + ~30s of network = fits comfortably in 3 min.
 * Effective unfollow rate: ~33/min — well within Bluesky's 600/min limit.
 */
export async function runScheduledUnfollow(env: Env): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) return;

  let pendingRow: { cnt: number } | null = null;
  try {
    pendingRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM ${TABLE} WHERE status = 'pending'`,
    ).first<{ cnt: number }>();
  } catch {
    return; // Table not created yet — skip silently
  }

  // Auto-retry failed items that have been stuck in 'failed' state for > 15 minutes
  try {
    await env.DB.prepare(
      `UPDATE ${TABLE} SET status = 'pending', processed_at = NULL, queued_at = datetime('now')
       WHERE status = 'failed' AND datetime(processed_at, '+15 minutes') < datetime('now')`,
    ).run();
    // Re-read pending count after potential retry reset
    pendingRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM ${TABLE} WHERE status = 'pending'`,
    ).first<{ cnt: number }>();
  } catch {}

  if (!pendingRow || pendingRow.cnt === 0) return;

  console.log(
    `[scheduled-unfollow] ${pendingRow.cnt} pending — processing up to ${BATCH_PER_CRON}`,
  );

  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  try {
    await agent.login({
      identifier: env.BLUESKY_HANDLE,
      password: env.BLUESKY_APP_PASSWORD,
    });
  } catch (err) {
    console.error("[scheduled-unfollow] Login failed:", err);
    return;
  }

  const rows = await env.DB.prepare(
    `SELECT id, did, follow_uri FROM ${TABLE}
     WHERE status = 'pending'
     ORDER BY queued_at ASC
     LIMIT ${BATCH_PER_CRON}`,
  ).all<{ id: number; did: string; follow_uri: string | null }>();

  let done = 0;
  let failed = 0;

  for (const row of rows.results) {
    try {
      let followUri = row.follow_uri;

      // No followUri stored — look it up from the authenticated agent
      if (!followUri) {
        try {
          const profile = await agent.getProfile({ actor: row.did });
          followUri = profile.data.viewer?.following ?? null;
        } catch {
          // Account gone or not followed — count as done
          await env.DB.prepare(
            `UPDATE ${TABLE} SET status = 'done', processed_at = datetime('now') WHERE id = ?`,
          )
            .bind(row.id)
            .run();
          done++;
          continue;
        }
      }

      if (followUri) {
        await agent.deleteFollow(followUri);
      }
      // Whether we deleted or weren't following, mark done
      await env.DB.prepare(
        `UPDATE ${TABLE} SET status = 'done', processed_at = datetime('now') WHERE id = ?`,
      )
        .bind(row.id)
        .run();
      done++;
    } catch (err) {
      console.error(`[scheduled-unfollow] Failed did=${row.did}:`, err);
      await env.DB.prepare(
        `UPDATE ${TABLE} SET status = 'failed', processed_at = datetime('now') WHERE id = ?`,
      )
        .bind(row.id)
        .run();
      failed++;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const remaining = pendingRow.cnt - rows.results.length;
  console.log(
    `[scheduled-unfollow] Batch done — ${done} unfollowed, ${failed} failed, ${remaining} remaining`,
  );
}
