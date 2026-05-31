import type { Env } from "../index";

type CronSettings = {
  auto_unfollow_enabled: string;
  auto_unfollow_interval_days: string;
  auto_unfollow_cap: string;
  auto_unfollow_last_run: string;
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
  lastRun: string | null;
}> {
  const [enabled, intervalDays, cap, lastRun] = await Promise.all([
    getSetting(env, "auto_unfollow_enabled", "0"),
    getSetting(env, "auto_unfollow_interval_days", "7"),
    getSetting(env, "auto_unfollow_cap", "50"),
    getSetting(env, "auto_unfollow_last_run", ""),
  ]);
  return {
    enabled: enabled === "1",
    intervalDays: Math.max(1, parseInt(intervalDays, 10) || 7),
    cap: Math.min(200, Math.max(1, parseInt(cap, 10) || 50)),
    lastRun: lastRun || null,
  };
}

export async function saveAutoUnfollowSettings(
  env: Env,
  settings: { enabled: boolean; intervalDays: number; cap: number },
): Promise<void> {
  await Promise.all([
    setSetting(env, "auto_unfollow_enabled", settings.enabled ? "1" : "0"),
    setSetting(env, "auto_unfollow_interval_days", String(settings.intervalDays)),
    setSetting(env, "auto_unfollow_cap", String(settings.cap)),
  ]);
}

/**
 * Runs as part of the every-3-min cron but gates itself via lastRun + intervalDays.
 * Only executes if: enabled AND (lastRun is null OR now > lastRun + intervalDays).
 */
export async function runAutoUnfollow(env: Env): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD || !env.FEEDGEN_PUBLISHER_DID) {
    console.log("[auto-unfollow] Missing credentials — skipping.");
    return;
  }

  const settings = await getAutoUnfollowSettings(env);

  if (!settings.enabled) {
    return; // Silently skip
  }

  // Check if enough time has passed since lastRun
  if (settings.lastRun) {
    const lastRunMs = new Date(settings.lastRun).getTime();
    const intervalMs = settings.intervalDays * 24 * 60 * 60 * 1000;
    if (Date.now() - lastRunMs < intervalMs) {
      console.log(`[auto-unfollow] Not due yet. Next run after ${new Date(lastRunMs + intervalMs).toISOString()}`);
      return;
    }
  }

  console.log(`[auto-unfollow] Starting — cap=${settings.cap}, interval=${settings.intervalDays}d`);

  try {
    const { AtpAgent } = await import("@atproto/api");
    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.login({
      identifier: env.BLUESKY_HANDLE,
      password: env.BLUESKY_APP_PASSWORD,
    });

    // Fetch following list (all pages, up to 2000 to be safe)
    const following: { did: string; followUri: string }[] = [];
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
          following.push({ did: f.did, followUri });
        }
      }
      followCursor = result.data.cursor;
    } while (followCursor && following.length < 2000);

    // Fetch followers set (just DIDs, for the diff)
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
    } while (followerCursor && followerDids.size < 5000);

    // Non-followers-back
    const nonFollowersBack = following.filter((f) => !followerDids.has(f.did));

    console.log(
      `[auto-unfollow] Following ${following.length}, Followers ${followerDids.size}, Non-followers-back: ${nonFollowersBack.length}`,
    );

    // Unfollow up to cap
    const toUnfollow = nonFollowersBack.slice(0, settings.cap);
    let unfollowed = 0;
    let errors = 0;

    for (const { followUri } of toUnfollow) {
      try {
        await agent.deleteFollow(followUri);
        unfollowed++;
        // Small delay to respect rate limits
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error("[auto-unfollow] Failed to unfollow:", err);
        errors++;
      }
    }

    await setSetting(env, "auto_unfollow_last_run", new Date().toISOString());

    console.log(
      `[auto-unfollow] Done — ${unfollowed} unfollowed, ${errors} errors, ${nonFollowersBack.length - toUnfollow.length} deferred (over cap).`,
    );
  } catch (err) {
    console.error("[auto-unfollow] Fatal error:", err);
  }
}
