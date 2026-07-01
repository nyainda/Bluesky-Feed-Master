import type { Env } from "../index";

const TABLE = "auto_follow_queue";

// 40 follows per 3-min cron = ~19,200/day attempts, capped by Bluesky at 5,000/day.
// 200ms delay between follows = 40 × 200ms = 8s overhead per tick, well within 3min.
const BATCH_PER_CRON = 40;
const DELAY_MS = 200;

// Follow-back check: verify 5 accounts per tick that haven't followed back after N days.
// 5 × 480 ticks/day = 2,400 checks/day — more than enough to track follow→followback loop.
const FOLLOWBACK_CHECK_PER_TICK = 5;

export async function ensureFollowQueueTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      did             TEXT NOT NULL UNIQUE,
      handle          TEXT NOT NULL DEFAULT '',
      followers_count INTEGER NOT NULL DEFAULT 0,
      market          TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'pending',
      queued_at       TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at    TEXT
    )`,
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS auto_follow_log (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      did                    TEXT NOT NULL UNIQUE,
      handle                 TEXT NOT NULL DEFAULT '',
      followers_count        INTEGER NOT NULL DEFAULT 0,
      market                 TEXT NOT NULL DEFAULT '',
      followed_at            TEXT NOT NULL DEFAULT (datetime('now')),
      follow_back_status     TEXT NOT NULL DEFAULT 'pending',
      follow_back_checked_at TEXT,
      unfollow_queued_at     TEXT
    )`,
  ).run();
}

export async function enqueueFollowItems(
  env: Env,
  items: Array<{ did: string; handle: string; followersCount: number; market: string }>,
): Promise<{ enqueued: number; skipped: number }> {
  await ensureFollowQueueTable(env);

  let enqueued = 0;
  let skipped  = 0;
  const CHUNK  = 50;

  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk  = items.slice(i, i + CHUNK);
    const stmts  = chunk.map((item) =>
      env.DB.prepare(
        `INSERT INTO ${TABLE} (did, handle, followers_count, market) VALUES (?, ?, ?, ?)
         ON CONFLICT(did) DO NOTHING`,
      ).bind(item.did, item.handle, item.followersCount, item.market),
    );
    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if ((r.meta as { changes?: number })?.changes ?? 0 > 0) enqueued++;
      else skipped++;
    }
  }

  return { enqueued, skipped };
}

export async function getFollowQueueStatus(env: Env): Promise<{
  pending: number; done: number; failed: number; total: number; estimatedMinutesLeft: number;
}> {
  try {
    await ensureFollowQueueTable(env);
    const rows = await env.DB.prepare(
      `SELECT status, COUNT(*) as cnt FROM ${TABLE} GROUP BY status`,
    ).all<{ status: string; cnt: number }>();

    const counts: Record<string, number> = { pending: 0, done: 0, failed: 0 };
    for (const row of rows.results) {
      if (row.status in counts) counts[row.status] = Number(row.cnt);
    }
    const total = counts.pending + counts.done + counts.failed;
    return {
      pending: counts.pending, done: counts.done, failed: counts.failed, total,
      estimatedMinutesLeft: Math.ceil((counts.pending / BATCH_PER_CRON) * 3),
    };
  } catch {
    return { pending: 0, done: 0, failed: 0, total: 0, estimatedMinutesLeft: 0 };
  }
}

export async function clearFollowQueue(env: Env): Promise<void> {
  try { await env.DB.prepare(`DELETE FROM ${TABLE} WHERE status = 'pending'`).run(); } catch {}
}

/**
 * Runs every cron tick. Drains BATCH_PER_CRON (10) items from the follow queue.
 * Rate: 10/tick × 480 ticks/day = 4,800/day — safely under Bluesky's 5,000/day limit.
 * No artificial long delays — 500ms between follows is already conservative.
 */
export async function runScheduledFollow(env: Env): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) return;

  await ensureFollowQueueTable(env);

  let pendingRow: { cnt: number } | null = null;
  try {
    // Retry transient failures after a short cooling-off window. This keeps
    // mass-follow jobs moving after Bluesky/network hiccups instead of leaving
    // the queue permanently stuck in failed state.
    await env.DB.prepare(
      `UPDATE ${TABLE} SET status = 'pending', processed_at = NULL, queued_at = datetime('now')
       WHERE status = 'failed' AND datetime(processed_at, '+15 minutes') < datetime('now')`,
    ).run();

    pendingRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM ${TABLE} WHERE status = 'pending'`,
    ).first<{ cnt: number }>();
  } catch { return; }

  if (!pendingRow || pendingRow.cnt === 0) return;

  console.log(`[scheduled-follow] ${pendingRow.cnt} pending — following up to ${BATCH_PER_CRON}`);

  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  try {
    await agent.login({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });
  } catch (err) {
    console.error("[scheduled-follow] Login failed:", err);
    return;
  }

  const rows = await env.DB.prepare(
    `SELECT id, did, handle, followers_count, market FROM ${TABLE}
     WHERE status = 'pending' ORDER BY queued_at ASC LIMIT ${BATCH_PER_CRON}`,
  ).all<{ id: number; did: string; handle: string; followers_count: number; market: string }>();

  let done = 0; let failed = 0;

  for (const row of rows.results) {
    try {
      await agent.follow(row.did);

      await env.DB.prepare(
        `UPDATE ${TABLE} SET status = 'done', processed_at = datetime('now') WHERE id = ?`,
      ).bind(row.id).run();

      // Record in follow log for the 7-day follow-back tracking
      await env.DB.prepare(
        `INSERT INTO auto_follow_log (did, handle, followers_count, market)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(did) DO UPDATE SET
           followed_at = datetime('now'),
           follow_back_status = 'pending',
           follow_back_checked_at = NULL,
           unfollow_queued_at = NULL`,
      ).bind(row.did, row.handle, row.followers_count, row.market).run();

      done++;
    } catch (err) {
      console.error(`[scheduled-follow] Failed did=${row.did}:`, err);
      await env.DB.prepare(
        `UPDATE ${TABLE} SET status = 'failed', processed_at = datetime('now') WHERE id = ?`,
      ).bind(row.id).run();
      failed++;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const remaining = pendingRow.cnt - rows.results.length;
  console.log(`[scheduled-follow] ${done} followed, ${failed} failed, ${remaining} remaining in queue`);
}

/**
 * Runs every cron tick. Checks FOLLOWBACK_CHECK_PER_TICK accounts from the follow log
 * that we followed > followbackDays ago and haven't checked yet.
 *
 * If they followed back → mark 'followed' (keep).
 * If not → mark 'unfollowed' + queue in unfollow_scheduled_queue for auto-unfollow.
 *
 * This closes the follow→check→unfollow loop automatically, forever.
 */
export async function runFollowBackCheck(env: Env): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) return;

  await ensureFollowQueueTable(env);

  const followbackDaysRow = await env.DB.prepare(
    "SELECT value FROM cron_settings WHERE key = 'auto_follow_followback_days'",
  ).first<{ value: string }>();
  const followbackDays = Math.max(1, parseInt(followbackDaysRow?.value ?? "7", 10));

  let rows: { results: Array<{ did: string; handle: string }> };
  try {
    rows = await env.DB.prepare(
      `SELECT did, handle FROM auto_follow_log
       WHERE follow_back_status = 'pending'
         AND datetime(followed_at, '+' || ? || ' days') < datetime('now')
         AND (follow_back_checked_at IS NULL OR datetime(follow_back_checked_at, '+1 day') < datetime('now'))
       LIMIT ?`,
    ).bind(followbackDays, FOLLOWBACK_CHECK_PER_TICK).all<{ did: string; handle: string }>();
  } catch { return; }

  if (rows.results.length === 0) return;

  console.log(`[followback-check] Checking ${rows.results.length} accounts (window: ${followbackDays}d)`);

  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  try {
    await agent.login({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });
  } catch { return; }

  const toUnfollow: Array<{ did: string }> = [];

  for (const row of rows.results) {
    try {
      const profile      = await agent.getProfile({ actor: row.did });
      const followedBack = !!profile.data.viewer?.followedBy;

      if (followedBack) {
        await env.DB.prepare(
          `UPDATE auto_follow_log SET follow_back_status = 'followed', follow_back_checked_at = datetime('now') WHERE did = ?`,
        ).bind(row.did).run();
        console.log(`[followback-check] ✓ @${row.handle} followed back`);
      } else {
        toUnfollow.push({ did: row.did });
        await env.DB.prepare(
          `UPDATE auto_follow_log SET follow_back_status = 'unfollowed', follow_back_checked_at = datetime('now'), unfollow_queued_at = datetime('now') WHERE did = ?`,
        ).bind(row.did).run();
        console.log(`[followback-check] ✗ @${row.handle} did NOT follow back → queuing unfollow`);
      }
    } catch {
      // Account may be gone or rate limited — mark checked so we don't retry immediately
      await env.DB.prepare(
        `UPDATE auto_follow_log SET follow_back_checked_at = datetime('now') WHERE did = ?`,
      ).bind(row.did).run();
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  if (toUnfollow.length > 0) {
    // Ensure the table exists before inserting (defensive — runScheduledUnfollow normally creates it first)
    try {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS unfollow_scheduled_queue (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          did          TEXT NOT NULL UNIQUE,
          follow_uri   TEXT,
          status       TEXT NOT NULL DEFAULT 'pending',
          queued_at    TEXT NOT NULL DEFAULT (datetime('now')),
          processed_at TEXT
        )`,
      ).run();
    } catch { /* already exists */ }

    const stmts = toUnfollow.map((u) =>
      env.DB.prepare(
        `INSERT INTO unfollow_scheduled_queue (did) VALUES (?) ON CONFLICT(did) DO NOTHING`,
      ).bind(u.did),
    );
    await env.DB.batch(stmts);
    console.log(`[followback-check] Queued ${toUnfollow.length} non-followers-back for auto-unfollow`);
  }
}
