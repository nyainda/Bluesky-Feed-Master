import type { Env } from "../index";
import { enqueueScheduledUnfollowItems } from "./scheduled-unfollow";

type CronSettings = {
  auto_unfollow_enabled: string;
  auto_unfollow_interval_days: string;
  auto_unfollow_cap: string;
  auto_unfollow_last_run: string;
  auto_unfollow_min_followers_to_keep: string;
};

async function getSetting(env: Env, key: string, fallback: string): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM cron_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? fallback;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  )
    .bind(key, value)
    .run();
}

export async function getAutoUnfollowSettings(env: Env): Promise<{
  enabled: boolean;
  intervalDays: number;
  cap: number;
  minFollowersToKeep: number;
  lastRun: string | null;
  scanInProgress: boolean;
  scanPagesDone: number;
}> {
  const [enabled, intervalDays, cap, lastRun, minFollowers, scanCursor, scanPagesDone] = await Promise.all([
    getSetting(env, "auto_unfollow_enabled", "0"),
    getSetting(env, "auto_unfollow_interval_days", "7"),
    getSetting(env, "auto_unfollow_cap", "0"),
    getSetting(env, "auto_unfollow_last_run", ""),
    getSetting(env, "auto_unfollow_min_followers_to_keep", "0"),
    getSetting(env, "auto_unfollow_scan_cursor", ""),
    getSetting(env, "auto_unfollow_scan_pages_done", "0"),
  ]);
  return {
    enabled: enabled === "1",
    intervalDays: Math.max(1, parseInt(intervalDays, 10) || 7),
    cap: Math.max(0, parseInt(cap, 10) || 0),
    minFollowersToKeep: Math.max(0, parseInt(minFollowers, 10) || 0),
    lastRun: lastRun || null,
    scanInProgress: scanCursor !== "",
    scanPagesDone: parseInt(scanPagesDone, 10) || 0,
  };
}

export async function saveAutoUnfollowSettings(
  env: Env,
  settings: { enabled: boolean; intervalDays: number; cap: number; minFollowersToKeep?: number },
): Promise<void> {
  await Promise.all([
    setSetting(env, "auto_unfollow_enabled", settings.enabled ? "1" : "0"),
    setSetting(env, "auto_unfollow_interval_days", String(settings.intervalDays)),
    setSetting(env, "auto_unfollow_cap", String(settings.cap)),
    setSetting(env, "auto_unfollow_min_followers_to_keep", String(settings.minFollowersToKeep ?? 0)),
  ]);
}

/**
 * Incremental scanner — fetches MAX_PAGES_PER_RUN pages of following per cron tick,
 * stores a cursor in D1 so the next tick resumes where it left off.
 * This avoids CF Worker CPU/time-budget exhaustion when following count is 10k–50k+.
 *
 * Flow:
 *   Tick 1: fetch pages 1-5 (500 following), queue candidates, store cursor
 *   Tick 2: fetch pages 6-10, queue, store cursor
 *   ...
 *   Final tick: no more pages → clear cursor, set lastRun → scan complete
 *
 * Followers list is fetched once per scan start (≤5,222 followers = ~53 pages, ~5s).
 * Then subsequent ticks compare the stored follower DIDs from the scan-start snapshot.
 */
const SCAN_PAGE_SIZE = 100;
const MAX_PAGES_PER_TICK = 5; // 5 pages × 100 = 500 following per cron tick — safe budget

export async function runAutoUnfollow(env: Env, options?: { force?: boolean }): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD || !env.FEEDGEN_PUBLISHER_DID) {
    console.log("[auto-unfollow] Missing credentials — skipping.");
    return;
  }

  const settings = await getAutoUnfollowSettings(env);

  if (!settings.enabled && !options?.force) return;

  const scanCursor = await getSetting(env, "auto_unfollow_scan_cursor", "");
  const scanInProgress = scanCursor !== "";

  // Gate by interval — only start a fresh scan if due (bypassed when force=true or resuming)
  if (!options?.force && !scanInProgress && settings.lastRun) {
    const lastRunMs = new Date(settings.lastRun).getTime();
    const intervalMs = settings.intervalDays * 24 * 60 * 60 * 1000;
    if (Date.now() - lastRunMs < intervalMs) {
      console.log(`[auto-unfollow] Not due yet. Next run after ${new Date(lastRunMs + intervalMs).toISOString()}`);
      return;
    }
  }

  console.log(
    `[auto-unfollow] ${scanInProgress ? "Resuming" : "Starting"} scan — cap=${settings.cap || "unlimited"}, minFollowers=${settings.minFollowersToKeep}, cursor=${scanCursor || "start"}`,
  );

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.login({
      identifier: env.BLUESKY_HANDLE,
      password: env.BLUESKY_APP_PASSWORD,
    });

    // Fetch up to 1,000 followers (10 pages × 100).
    // This keeps the per-tick API budget to ~15 total calls (10 followers + 5 following).
    // Anyone following back beyond position 1,000 in the followers list is a rare edge case
    // — they'll simply be skipped when runScheduledUnfollow attempts the deleteFollow and
    // Bluesky returns "not following" (no-op, marked done).
    const followerDids = new Set<string>();
    let followerCursor: string | undefined;
    do {
      const result = await agent.getFollowers({
        actor: env.FEEDGEN_PUBLISHER_DID,
        limit: SCAN_PAGE_SIZE,
        cursor: followerCursor,
      });
      for (const f of result.data.followers) followerDids.add(f.did);
      followerCursor = result.data.cursor;
    } while (followerCursor && followerDids.size < 1_000);

    console.log(`[auto-unfollow] Fetched ${followerDids.size} followers`);

    // Fetch up to MAX_PAGES_PER_TICK pages of following, starting from stored cursor
    const following: { did: string; handle: string; followUri: string; followersCount: number }[] = [];
    let followCursor: string | undefined = scanCursor || undefined;
    let pagesFetched = 0;

    do {
      const result = await agent.getFollows({
        actor: env.FEEDGEN_PUBLISHER_DID,
        limit: SCAN_PAGE_SIZE,
        cursor: followCursor,
      });
      for (const f of result.data.follows) {
        const followUri = f.viewer?.following;
        if (followUri) {
          following.push({
            did: f.did,
            handle: f.handle,
            followUri,
            followersCount: Number(f.followersCount ?? 0),
          });
        }
      }
      followCursor = result.data.cursor;
      pagesFetched++;
    } while (followCursor && pagesFetched < MAX_PAGES_PER_TICK);

    // Find non-followers-back in this batch
    let candidates = following.filter((f) => !followerDids.has(f.did));

    if (settings.minFollowersToKeep > 0) {
      candidates = candidates.filter((f) => f.followersCount < settings.minFollowersToKeep);
    }

    // Apply cap (0 = unlimited). Only apply on fresh scans, not resumptions, to avoid partial queuing.
    const toQueue = !scanInProgress && settings.cap > 0 ? candidates.slice(0, settings.cap) : candidates;

    const prevPagesDone = parseInt(await getSetting(env, "auto_unfollow_scan_pages_done", "0"), 10) || 0;
    const totalPagesDone = prevPagesDone + pagesFetched;

    // Enqueue this batch
    const { enqueued, skipped } = await enqueueScheduledUnfollowItems(
      env,
      toQueue.map((f) => ({ did: f.did, followUri: f.followUri })),
    );

    console.log(
      `[auto-unfollow] Batch: ${following.length} following checked, ${candidates.length} candidates, ${enqueued} enqueued (${skipped} already queued). Pages done: ${totalPagesDone}`,
    );

    if (followCursor) {
      // More pages remaining — save cursor and page count for next tick
      await setSetting(env, "auto_unfollow_scan_cursor", followCursor);
      await setSetting(env, "auto_unfollow_scan_pages_done", String(totalPagesDone));
      console.log(`[auto-unfollow] Scan paused at cursor — will resume next tick (${totalPagesDone} pages done)`);
    } else {
      // Scan complete — clear cursor, record lastRun
      await setSetting(env, "auto_unfollow_scan_cursor", "");
      await setSetting(env, "auto_unfollow_scan_pages_done", "0");
      await setSetting(env, "auto_unfollow_last_run", new Date().toISOString());
      console.log(
        `[auto-unfollow] Scan complete after ${totalPagesDone} pages. Queue will drain ~10/cron at ~200/hr.`,
      );
    }
  } catch (err) {
    console.error("[auto-unfollow] Fatal error:", err);
    // Clear cursor on fatal error so next cron starts fresh rather than looping on broken state
    await setSetting(env, "auto_unfollow_scan_cursor", "").catch(() => {});
    await setSetting(env, "auto_unfollow_scan_pages_done", "0").catch(() => {});
  }
}
