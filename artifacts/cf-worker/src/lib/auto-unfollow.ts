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
}> {
  const [enabled, intervalDays, cap, lastRun, minFollowers] = await Promise.all([
    getSetting(env, "auto_unfollow_enabled", "0"),
    getSetting(env, "auto_unfollow_interval_days", "7"),
    getSetting(env, "auto_unfollow_cap", "0"),
    getSetting(env, "auto_unfollow_last_run", ""),
    getSetting(env, "auto_unfollow_min_followers_to_keep", "0"),
  ]);
  return {
    enabled: enabled === "1",
    intervalDays: Math.max(1, parseInt(intervalDays, 10) || 7),
    cap: Math.max(0, parseInt(cap, 10) || 0), // 0 = unlimited
    minFollowersToKeep: Math.max(0, parseInt(minFollowers, 10) || 0),
    lastRun: lastRun || null,
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
 * Runs on the cron interval gate (intervalDays). Instead of directly unfollowing,
 * it queues non-followers-back into unfollow_scheduled_queue. The scheduled-unfollow
 * processor then trickles through the queue at a slow, human-like pace (10/cron = ~200/hr)
 * to stay comfortably within Bluesky's rate limits, even for queues of 10k–40k+.
 *
 * minFollowersToKeep: skip accounts with >= this many followers (0 = unfollow all)
 * cap: max items to queue per scan (0 = unlimited — queue all non-followers-back)
 */
export async function runAutoUnfollow(env: Env, options?: { force?: boolean }): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD || !env.FEEDGEN_PUBLISHER_DID) {
    console.log("[auto-unfollow] Missing credentials — skipping.");
    return;
  }

  const settings = await getAutoUnfollowSettings(env);

  if (!settings.enabled && !options?.force) return;

  // Gate by interval — bypassed when force=true (manual trigger)
  if (!options?.force && settings.lastRun) {
    const lastRunMs = new Date(settings.lastRun).getTime();
    const intervalMs = settings.intervalDays * 24 * 60 * 60 * 1000;
    if (Date.now() - lastRunMs < intervalMs) {
      console.log(`[auto-unfollow] Not due yet. Next run after ${new Date(lastRunMs + intervalMs).toISOString()}`);
      return;
    }
  }

  console.log(
    `[auto-unfollow] Scanning — cap=${settings.cap || "unlimited"}, minFollowers=${settings.minFollowersToKeep}, interval=${settings.intervalDays}d`,
  );

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.login({
      identifier: env.BLUESKY_HANDLE,
      password: env.BLUESKY_APP_PASSWORD,
    });

    // Fetch full following list (paginate up to 10k to handle large accounts)
    const following: { did: string; handle: string; followUri: string; followersCount: number }[] = [];
    let followCursor: string | undefined;
    do {
      const result = await agent.getFollows({
        actor: env.FEEDGEN_PUBLISHER_DID,
        limit: 100,
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
    } while (followCursor && following.length < 10_000);

    // Fetch follower DIDs (paginate up to 10k)
    const followerDids = new Set<string>();
    let followerCursor: string | undefined;
    do {
      const result = await agent.getFollowers({
        actor: env.FEEDGEN_PUBLISHER_DID,
        limit: 100,
        cursor: followerCursor,
      });
      for (const f of result.data.followers) {
        followerDids.add(f.did);
      }
      followerCursor = result.data.cursor;
    } while (followerCursor && followerDids.size < 10_000);

    // Non-followers-back
    let candidates = following.filter((f) => !followerDids.has(f.did));

    // Filter: skip accounts with >= minFollowersToKeep followers (influencers worth keeping)
    if (settings.minFollowersToKeep > 0) {
      const before = candidates.length;
      candidates = candidates.filter((f) => f.followersCount < settings.minFollowersToKeep);
      console.log(
        `[auto-unfollow] Kept ${candidates.length} of ${before} after filtering accounts with ${settings.minFollowersToKeep}+ followers`,
      );
    }

    console.log(
      `[auto-unfollow] Following=${following.length}, Followers=${followerDids.size}, Candidates=${candidates.length}`,
    );

    // Apply cap (0 = no limit — queue everything)
    const toQueue = settings.cap > 0 ? candidates.slice(0, settings.cap) : candidates;

    // Enqueue into scheduled queue — actual unfollows happen slowly via runScheduledUnfollow
    const { enqueued, skipped } = await enqueueScheduledUnfollowItems(
      env,
      toQueue.map((f) => ({ did: f.did, followUri: f.followUri })),
    );

    await setSetting(env, "auto_unfollow_last_run", new Date().toISOString());

    console.log(
      `[auto-unfollow] Queued ${enqueued} (${skipped} already pending). ` +
        `Queue will be processed ~10/cron at ~200/hr — estimated ${Math.ceil(enqueued / 200)}h.`,
    );
  } catch (err) {
    console.error("[auto-unfollow] Fatal error:", err);
  }
}
