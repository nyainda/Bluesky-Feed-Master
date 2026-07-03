import type { Env } from "../index";

const TABLE = "unfollow_scheduled_queue";
// Capped at 15/tick to stay under Cloudflare Workers Free plan's 50-subrequest-
// per-invocation limit. The same cron tick also runs the jetstream indexer,
// feed scheduler, author scoring, auto-follow, follow-back check, and content
// amplifier — each making its own subrequests (D1 calls, Bluesky API calls,
// the Jetstream WebSocket). 100/tick blew that budget and caused
// "Too many subrequests" errors that killed every later phase in the tick.
// 15/tick × 480 ticks/day = ~7,200/day — 51k queued drains in ~7 days.
const BATCH_PER_CRON = 15;
const DELAY_MS = 150;          // 150ms between each deleteFollow — 15 × 150ms = 2.25s overhead per tick

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
      // ON CONFLICT: only reset 'failed' items to pending (retry). Leave 'done' items alone —
      // resetting them back to 'pending' would undo completed unfollows and create an infinite cycle
      // where the auto-unfollow scan re-queues items that the drain just finished.
      env.DB.prepare(
        `INSERT INTO ${TABLE} (did, follow_uri) VALUES (?, ?)
         ON CONFLICT(did) DO UPDATE SET
           follow_uri   = excluded.follow_uri,
           status       = 'pending',
           queued_at    = datetime('now'),
           processed_at = NULL
         WHERE status = 'failed'`,
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
async function saveSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ).bind(key, value).run();
}

export async function runScheduledUnfollow(env: Env): Promise<void> {
  // Write a heartbeat immediately so dashboard can confirm function was called
  const attemptedAt = new Date().toISOString();
  try { await saveSetting(env, "last_drain_attempted_at", attemptedAt); } catch {}

  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) {
    try { await saveSetting(env, "last_drain_skip_reason", "missing-credentials"); } catch {}
    return;
  }

  let pendingRow: { cnt: number } | null = null;
  try {
    pendingRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM ${TABLE} WHERE status = 'pending'`,
    ).first<{ cnt: number }>();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await saveSetting(env, "last_drain_skip_reason", `table-error: ${msg}`); } catch {}
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

  if (!pendingRow || pendingRow.cnt === 0) {
    try { await saveSetting(env, "last_drain_skip_reason", `no-pending (cnt=${pendingRow?.cnt ?? "null"})`); } catch {}
    return;
  }

  try { await saveSetting(env, "last_drain_skip_reason", ""); } catch {} // Clear skip reason — we're proceeding

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
  let lastError = "";

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
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled-unfollow] Failed did=${row.did}:`, msg);
      lastError = msg;
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

  // Save telemetry so the dashboard can show last drain results
  try {
    await env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    ).bind("last_drain_at", new Date().toISOString()).run();
    await env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    ).bind("last_drain_done", String(done)).run();
    await env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    ).bind("last_drain_failed", String(failed)).run();
    if (lastError) {
      await env.DB.prepare(
        "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      ).bind("last_drain_error", lastError).run();
    }
  } catch {}
}
