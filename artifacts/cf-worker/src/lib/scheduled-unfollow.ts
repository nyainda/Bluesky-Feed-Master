import type { Env } from "../index";

const TABLE = "unfollow_scheduled_queue";

// ── Throughput tuning ────────────────────────────────────────────────────────
//
// Free-tier subrequest budget: 50 per Worker invocation.
//
// With BATCHED D1 writes (all status updates sent in one env.DB.batch() call
// at the end of the loop) the per-tick budget looks like:
//
//   Setup (before loop):
//     saveSetting(attempted_at)     = 1
//     SELECT COUNT(*) pending       = 1
//     UPDATE failed→pending reset   = 1
//     SELECT COUNT(*) after reset   = 1
//     saveSetting(skip_reason, "")  = 1
//     agent.login()                 = 1
//     SELECT id,did,follow_uri LIMIT = 1
//                              subtotal = 7
//
//   Per item WITH follow_uri stored:
//     agent.deleteFollow()          = 1 each
//
//   Per item WITHOUT follow_uri (rare edge case):
//     agent.getProfile()            = +1 extra each
//
//   End (batched):
//     env.DB.batch([N status writes]) = 1   ← key saving vs N individual writes
//     saveSetting(last_drain_at)      = 1
//     saveSetting(last_drain_done)    = 1
//     saveSetting(last_drain_failed)  = 1
//     total_unfollowed_ever update    = 1
//     unfollow_daily_* update         = 1
//                              subtotal = 6
//
//   Total with 20 items (all with URI): 7 + 20 + 1 + 6 = 34 ✓  (32% below cap)
//   Total with 20 items (all no URI):   7 + 40 + 1 + 6 = 54 ✗  (over — rare)
//   Total with 20 items (mixed, ~15 URI + 5 no-URI): 7 + 25 + 1 + 6 = 39 ✓
//
// In practice nearly all queued items have follow_uri (both runAutoUnfollow and
// runQueueAllScan store it). The no-URI path is a fallback for orphaned rows.
//
// DELAY_MS: 100ms × 20 = 2s of deliberate sleep per tick. Bluesky's rate limit
// is 600 unfollows/min; 20 items/tick × 20 ticks/hr = 400/hr = 6.7/min — well
// within limits. 100ms gives enough time for the deleteFollow response to land.
//
// Previous config: BATCH=10, DELAY=150ms, slot-0-only (every 12 min) = ~50/hr
// New config:      BATCH=20, DELAY=100ms, every tick (every 3 min)   = ~400/hr
//                                                         8× throughput improvement

const BATCH_PER_CRON = 20;
const DELAY_MS = 100;

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
    // New rate: 20 items every 3 minutes = ~400/hr
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

async function saveSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ).bind(key, value).run();
}

/**
 * Called every SOCIAL_CRON tick (every 3 min). Returns { drained: true } if it
 * processed items this tick so the cron can skip other social jobs (budget used).
 * Returns { drained: false } when queue was empty — cron proceeds with other jobs.
 *
 * Processes up to BATCH_PER_CRON=20 pending items per tick using a single batched
 * D1 write at the end (saves N-1 subrequests vs per-item writes).
 * Rate: ~20 items × 20 ticks/hr = ~400 unfollows/hr. Well within Bluesky's 600/min.
 */
export async function runScheduledUnfollow(env: Env): Promise<{ drained: boolean }> {
  // Write a heartbeat immediately so dashboard can confirm function was called
  const attemptedAt = new Date().toISOString();
  try { await saveSetting(env, "last_drain_attempted_at", attemptedAt); } catch {}

  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) {
    try { await saveSetting(env, "last_drain_skip_reason", "missing-credentials"); } catch {}
    return { drained: false };
  }

  let pendingRow: { cnt: number } | null = null;
  try {
    pendingRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM ${TABLE} WHERE status = 'pending'`,
    ).first<{ cnt: number }>();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await saveSetting(env, "last_drain_skip_reason", `table-error: ${msg}`); } catch {}
    return { drained: false }; // Table not created yet — skip silently
  }

  // Auto-retry failed items stuck in 'failed' state for > 15 minutes
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
    return { drained: false }; // Nothing to do — caller can run other social jobs
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
    return { drained: false };
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
  let hitSubrequestLimit = false;

  // Collect status results during the loop — write them all in one batch() call at
  // the end. This saves (N-1) subrequests vs per-item writes, allowing 20 items to
  // fit comfortably within the 50-subrequest free-tier cap.
  const statusUpdates: Array<{ id: number; status: "done" | "failed" }> = [];

  const isSubrequestLimitError = (msg: string) => /too many subrequests/i.test(msg);

  for (const row of rows.results) {
    processedCount++;
    try {
      let followUri = row.follow_uri;

      // No followUri stored — look it up from the authenticated agent (rare edge case)
      if (!followUri) {
        try {
          const profile = await agent.getProfile({ actor: row.did });
          followUri = profile.data.viewer?.following ?? null;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (isSubrequestLimitError(msg)) {
            hitSubrequestLimit = true;
            break;
          }
          // Account gone or not followed — count as done
          statusUpdates.push({ id: row.id, status: "done" });
          done++;
          continue;
        }
      }

      if (followUri) {
        await agent.deleteFollow(followUri);
      }
      // Whether we deleted or weren't following, mark done
      statusUpdates.push({ id: row.id, status: "done" });
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled-unfollow] Failed did=${row.did}:`, msg);
      lastError = msg;

      if (isSubrequestLimitError(msg)) {
        // Budget exhausted — even the batch write below would fail.
        // Leave these items pending for the next tick (picks up from same rows).
        console.error(
          `[scheduled-unfollow] Subrequest limit hit after ${processedCount - 1} items — stopping batch early.`,
        );
        hitSubrequestLimit = true;
        break;
      }

      statusUpdates.push({ id: row.id, status: "failed" });
      failed++;
    }

    // No delay after the last item — the sleep is just spacing for Bluesky's rate limit
    if (processedCount < rows.results.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  // ── Batch write all status updates in one D1 call ─────────────────────────
  // Saves N-1 subrequests vs per-item writes. Skipped on subrequest-limit hit
  // since even this write would throw — items remain pending for next tick.
  if (!hitSubrequestLimit && statusUpdates.length > 0) {
    try {
      await env.DB.batch(
        statusUpdates.map(({ id, status }) =>
          env.DB.prepare(
            `UPDATE ${TABLE} SET status = ?, processed_at = datetime('now') WHERE id = ?`,
          ).bind(status, id),
        ),
      );
    } catch (err) {
      console.error("[scheduled-unfollow] Batch status write failed:", err instanceof Error ? err.message : String(err));
    }
  }

  const remaining = pendingRow.cnt - done;
  console.log(
    `[scheduled-unfollow] Batch done — ${done} unfollowed, ${failed} failed, ~${remaining} remaining`,
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
    if (done > 0) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      await env.DB.prepare(
        `INSERT INTO cron_settings (key, value) VALUES ('total_unfollowed_ever', ?)
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(CAST(value AS INTEGER) + ? AS TEXT),
           updated_at = datetime('now')`,
      ).bind(String(done), done).run();
      // Per-day counter for the sparkline chart
      await env.DB.prepare(
        `INSERT INTO cron_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(CAST(value AS INTEGER) + ? AS TEXT),
           updated_at = datetime('now')`,
      ).bind(`unfollow_daily_${today}`, String(done), done).run();
    }
  } catch {}

  return { drained: true };
}
