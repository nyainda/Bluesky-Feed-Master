import type { Env } from "../index";

const TABLE = "unfollow_scheduled_queue";
// This job now gets its own fully dedicated SOCIAL_CRON tick (see cron.ts
// rotation), but it still has to fit within Cloudflare Workers Free plan's
// 50-subrequest-per-invocation cap *by itself*: ~7 setup/telemetry D1 calls +
// agent.login + up to 2 subrequests per item (deleteFollow/getProfile +
// D1 update) was measured to land at ~40-45 with 15 items — too close to the
// cap, and once the cap is hit mid-loop, the "mark failed" write inside the
// catch block was ALSO a subrequest that then threw uncaught, skipping the
// end-of-run telemetry entirely and making the drain look permanently stuck.
// 10/tick gives ~31 subrequests (8 setup + 10×2.3) — 38% below the 50-cap,
// well-measured headroom. 15 items hit 40-45 (too close); 10 is the sweet
// spot: meaningfully faster without risking mid-loop cap exhaustion.
// See STOP_ON_SUBREQUEST_LIMIT below for the clean bail-out on cap hit.
const BATCH_PER_CRON = 10;
const DELAY_MS = 150;          // 150ms between each deleteFollow — 10 × 150ms = 1.5s overhead per tick

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
  let processedCount = 0;

  const isSubrequestLimitError = (msg: string) => /too many subrequests/i.test(msg);

  // Best-effort status update — deliberately swallows errors so that a
  // subrequest-cap hit here (a write, i.e. itself a subrequest) can never
  // escape uncaught and skip the end-of-run telemetry below.
  const markStatus = async (id: number, status: "done" | "failed") => {
    try {
      await env.DB.prepare(
        `UPDATE ${TABLE} SET status = ?, processed_at = datetime('now') WHERE id = ?`,
      )
        .bind(status, id)
        .run();
    } catch (err) {
      console.error(`[scheduled-unfollow] Failed to mark id=${id} as ${status}:`, err);
    }
  };

  for (const row of rows.results) {
    processedCount++;
    try {
      let followUri = row.follow_uri;

      // No followUri stored — look it up from the authenticated agent
      if (!followUri) {
        try {
          const profile = await agent.getProfile({ actor: row.did });
          followUri = profile.data.viewer?.following ?? null;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (isSubrequestLimitError(msg)) throw err; // Bail the whole loop below, don't mask it as "done"
          // Account gone or not followed — count as done
          await markStatus(row.id, "done");
          done++;
          continue;
        }
      }

      if (followUri) {
        await agent.deleteFollow(followUri);
      }
      // Whether we deleted or weren't following, mark done
      await markStatus(row.id, "done");
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled-unfollow] Failed did=${row.did}:`, msg);
      lastError = msg;

      if (isSubrequestLimitError(msg)) {
        // Budget is exhausted for this invocation — every further D1/API call
        // (including the "mark failed" write below) would also throw. Leave
        // this item pending for the next dedicated tick instead of burning
        // more calls trying to record failure, and stop the loop entirely.
        console.error(
          `[scheduled-unfollow] Subrequest limit hit after ${processedCount - 1} items — stopping batch early.`,
        );
        break;
      }

      await markStatus(row.id, "failed");
      failed++;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const remaining = pendingRow.cnt - done - failed;
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
    // Accumulate a lifetime unfollow counter that survives queue clears.
    // Uses SQLite arithmetic in the ON CONFLICT clause for an atomic increment.
    if (done > 0) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      await env.DB.prepare(
        `INSERT INTO cron_settings (key, value) VALUES ('total_unfollowed_ever', ?)
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(CAST(value AS INTEGER) + ? AS TEXT),
           updated_at = datetime('now')`,
      ).bind(String(done), done).run();
      // Per-day counter for the sparkline chart — key = unfollow_daily_YYYY-MM-DD
      await env.DB.prepare(
        `INSERT INTO cron_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(CAST(value AS INTEGER) + ? AS TEXT),
           updated_at = datetime('now')`,
      ).bind(`unfollow_daily_${today}`, String(done), done).run();
    }
  } catch {}
}
