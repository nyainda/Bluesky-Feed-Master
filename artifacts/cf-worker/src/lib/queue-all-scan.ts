/**
 * Queue-all-following scan — cursor-based, cron-driven.
 *
 * Instead of one big waitUntil() that CF can kill mid-run, we split the
 * pagination across many 3-minute cron ticks. Each tick scans PAGES_PER_TICK
 * pages (2 000 accounts), saves the cursor to D1, and returns. If CF kills
 * the worker mid-tick we lose at most one page of work (100 accounts), and
 * the very next cron tick picks up at the last saved cursor.
 *
 * At 20 pages/tick × 3 min/tick: 51k accounts = ~26 ticks = ~78 min total.
 */

import type { Env } from "../index";

// Scan now runs on CONTENT_CRON — its own fresh 50-subrequest budget, no drain competition.
// 10 pages/tick = 1,000 accounts/tick × 20 ticks/hr = 20k accounts/hr.
// ~23k remaining accounts / 20k/hr ≈ ~1.2 hours to finish the scan.
const PAGES_PER_TICK = 10; // 1 000 accounts per tick

async function getSetting(env: Env, key: string): Promise<string> {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM cron_settings WHERE key = ?",
    )
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? "";
  } catch {
    return "";
  }
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  )
    .bind(key, value)
    .run();
}

export async function startQueueAllScan(env: Env): Promise<void> {
  await Promise.all([
    setSetting(env, "queue_all_mode", "1"),
    setSetting(env, "queue_all_cursor", ""),
    setSetting(env, "queue_all_pages", "0"),
    setSetting(env, "queue_all_enqueued", "0"),
    setSetting(env, "queue_all_started_at", new Date().toISOString()),
    setSetting(env, "queue_all_completed_at", ""),
  ]);
}

export async function cancelQueueAllScan(env: Env): Promise<void> {
  await setSetting(env, "queue_all_mode", "0");
}

export async function getQueueAllStatus(env: Env): Promise<{
  scanning: boolean;
  pagesScanned: number;
  totalEnqueued: number;
  startedAt: string | null;
  completedAt: string | null;
}> {
  try {
    const rows = await env.DB.prepare(
      `SELECT key, value FROM cron_settings
       WHERE key IN ('queue_all_mode','queue_all_pages','queue_all_enqueued','queue_all_started_at','queue_all_completed_at')`,
    ).all<{ key: string; value: string }>();

    const kv: Record<string, string> = {};
    for (const r of rows.results) kv[r.key] = r.value;

    return {
      scanning: kv["queue_all_mode"] === "1",
      pagesScanned: parseInt(kv["queue_all_pages"] ?? "0", 10) || 0,
      totalEnqueued: parseInt(kv["queue_all_enqueued"] ?? "0", 10) || 0,
      startedAt: kv["queue_all_started_at"] || null,
      completedAt: kv["queue_all_completed_at"] || null,
    };
  } catch {
    return { scanning: false, pagesScanned: 0, totalEnqueued: 0, startedAt: null, completedAt: null };
  }
}

/**
 * Called by the every-3-minute cron. Processes up to PAGES_PER_TICK pages
 * from the following list and enqueues each account. Saves cursor after
 * every 5 pages so a mid-tick kill loses at most 500 accounts of progress.
 */
export async function runQueueAllScan(env: Env): Promise<void> {
  const mode = await getSetting(env, "queue_all_mode");
  if (mode !== "1") return;

  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) {
    console.error("[queue-all-scan] Missing credentials — cancelling");
    await setSetting(env, "queue_all_mode", "0");
    return;
  }

  const { AtpAgent } = await import("@atproto/api");
  const { enqueueScheduledUnfollowItems, ensureScheduledUnfollowTable } =
    await import("./scheduled-unfollow");

  await ensureScheduledUnfollowTable(env);

  const agent = new AtpAgent({ service: "https://bsky.social" });
  try {
    await agent.login({
      identifier: env.BLUESKY_HANDLE,
      password: env.BLUESKY_APP_PASSWORD,
    });
  } catch (err) {
    console.error(
      "[queue-all-scan] Login failed:",
      err instanceof Error ? err.message : String(err),
    );
    return; // Don't cancel — try again next tick
  }

  const cursorRaw = await getSetting(env, "queue_all_cursor");
  let cursor: string | undefined = cursorRaw || undefined;
  let pagesScanned = parseInt(await getSetting(env, "queue_all_pages"), 10) || 0;
  let totalEnqueued =
    parseInt(await getSetting(env, "queue_all_enqueued"), 10) || 0;

  let tickPages = 0;

  while (tickPages < PAGES_PER_TICK) {
    try {
      const result = await agent.getFollows({
        actor: env.BLUESKY_HANDLE,
        limit: 100,
        cursor,
      });

      const items = result.data.follows.map((f) => ({
        did: f.did,
        followUri:
          (f.viewer as { following?: string })?.following ?? null,
      }));

      if (items.length > 0) {
        const { enqueued } = await enqueueScheduledUnfollowItems(env, items);
        totalEnqueued += enqueued;
      }

      cursor = result.data.cursor;
      pagesScanned++;
      tickPages++;

      // Checkpoint every 5 pages so a kill loses ≤500 accounts
      if (tickPages % 5 === 0) {
        await Promise.all([
          setSetting(env, "queue_all_cursor", cursor ?? ""),
          setSetting(env, "queue_all_pages", String(pagesScanned)),
          setSetting(env, "queue_all_enqueued", String(totalEnqueued)),
        ]);
      }

      if (!cursor) {
        // Exhausted all pages — mark complete
        await Promise.all([
          setSetting(env, "queue_all_mode", "0"),
          setSetting(env, "queue_all_cursor", ""),
          setSetting(env, "queue_all_pages", String(pagesScanned)),
          setSetting(env, "queue_all_enqueued", String(totalEnqueued)),
          setSetting(env, "queue_all_completed_at", new Date().toISOString()),
        ]);
        console.log(
          `[queue-all-scan] COMPLETE — ${pagesScanned} pages, ${totalEnqueued} new accounts queued`,
        );
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[queue-all-scan] Page ${pagesScanned + 1} failed:`, msg);

      // If we had a cursor and the first page of this tick failed, the cursor
      // may have expired (Bluesky cursors go stale after hours). Reset to start
      // of the following list so the next tick resumes from page 1.
      if (tickPages === 0 && cursor) {
        console.error("[queue-all-scan] Stale cursor detected — resetting to start of following list");
        cursor = undefined;
        pagesScanned = 0;
        totalEnqueued = 0;
        await Promise.all([
          setSetting(env, "queue_all_cursor", ""),
          setSetting(env, "queue_all_pages", "0"),
          setSetting(env, "queue_all_enqueued", "0"),
        ]);
      }
      break; // Save progress and try again next tick
    }
  }

  // End of tick — save cursor so next tick continues from here
  await Promise.all([
    setSetting(env, "queue_all_cursor", cursor ?? ""),
    setSetting(env, "queue_all_pages", String(pagesScanned)),
    setSetting(env, "queue_all_enqueued", String(totalEnqueued)),
  ]);

  console.log(
    `[queue-all-scan] Tick done — ${tickPages} pages this tick, ${pagesScanned} total pages, ${totalEnqueued} queued`,
  );
}
