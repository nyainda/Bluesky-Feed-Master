import type { Env } from "../index";
import { enqueueFollowItems, ensureFollowQueueTable } from "./scheduled-follow";

// Market → search terms for finding quality accounts in that region
const MARKET_KEYWORDS: Record<string, string[]> = {
  usa:       ["news", "tech startup", "marketing", "entrepreneur", "business"],
  europe:    ["startup europe", "tech berlin", "london business", "paris tech", "amsterdam"],
  uk:        ["London", "UK business", "British", "Manchester", "Edinburgh"],
  canada:    ["Canada", "Toronto", "Vancouver", "Ottawa", "Canadian startup"],
  australia: ["Australia", "Sydney", "Melbourne", "Brisbane", "Aussie"],
  latam:     ["Brasil", "Mexico", "Argentina", "Colombia", "Latin America"],
  asia:      ["Singapore", "Tokyo", "Seoul", "Mumbai", "Asia tech"],
};

async function getSetting(env: Env, key: string, fallback: string): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM cron_settings WHERE key = ?")
    .bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ).bind(key, value).run();
}

export async function getAutoFollowSettings(env: Env): Promise<{
  enabled: boolean;
  intervalDays: number;
  cap: number;
  markets: string[];
  minFollowers: number;
  maxFollowers: number;
  minPosts: number;
  followbackDays: number;
  lastRun: string | null;
}> {
  const [enabled, intervalDays, cap, markets, minFollowers, maxFollowers, minPosts, followbackDays, lastRun] =
    await Promise.all([
      getSetting(env, "auto_follow_enabled", "0"),
      getSetting(env, "auto_follow_interval_days", "3"),
      getSetting(env, "auto_follow_cap", "50"),
      getSetting(env, "auto_follow_markets", '["usa","europe","uk"]'),
      getSetting(env, "auto_follow_min_followers", "100"),
      getSetting(env, "auto_follow_max_followers", "50000"),
      getSetting(env, "auto_follow_min_posts", "5"),
      getSetting(env, "auto_follow_followback_days", "7"),
      getSetting(env, "auto_follow_last_run", ""),
    ]);

  let parsedMarkets: string[] = ["usa", "europe", "uk"];
  try { parsedMarkets = JSON.parse(markets); } catch {}

  return {
    enabled: enabled === "1",
    intervalDays: Math.max(1, parseInt(intervalDays, 10) || 3),
    cap: Math.max(1, parseInt(cap, 10) || 50),
    markets: parsedMarkets,
    minFollowers: Math.max(0, parseInt(minFollowers, 10) || 100),
    maxFollowers: Math.max(0, parseInt(maxFollowers, 10) || 50_000),
    minPosts: Math.max(0, parseInt(minPosts, 10) || 5),
    followbackDays: Math.max(1, parseInt(followbackDays, 10) || 7),
    lastRun: lastRun || null,
  };
}

export async function saveAutoFollowSettings(env: Env, settings: {
  enabled?: boolean;
  intervalDays?: number;
  cap?: number;
  markets?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  minPosts?: number;
  followbackDays?: number;
}): Promise<void> {
  const writes: Promise<void>[] = [];
  if (settings.enabled !== undefined) writes.push(setSetting(env, "auto_follow_enabled", settings.enabled ? "1" : "0"));
  if (settings.intervalDays !== undefined) writes.push(setSetting(env, "auto_follow_interval_days", String(settings.intervalDays)));
  if (settings.cap !== undefined) writes.push(setSetting(env, "auto_follow_cap", String(settings.cap)));
  if (settings.markets !== undefined) writes.push(setSetting(env, "auto_follow_markets", JSON.stringify(settings.markets)));
  if (settings.minFollowers !== undefined) writes.push(setSetting(env, "auto_follow_min_followers", String(settings.minFollowers)));
  if (settings.maxFollowers !== undefined) writes.push(setSetting(env, "auto_follow_max_followers", String(settings.maxFollowers)));
  if (settings.minPosts !== undefined) writes.push(setSetting(env, "auto_follow_min_posts", String(settings.minPosts)));
  if (settings.followbackDays !== undefined) writes.push(setSetting(env, "auto_follow_followback_days", String(settings.followbackDays)));
  await Promise.all(writes);
}

/**
 * Discovers and queues quality accounts to follow from the configured markets.
 * Strategy:
 *   1. Search Bluesky for recent posts matching market keywords
 *   2. Collect unique authors and their profile stats
 *   3. Filter: not already following, not in follow log, quality thresholds
 *   4. Enqueue for gradual follow via runScheduledFollow (8/cron ~160/hr)
 */
export async function runAutoFollow(env: Env, options?: { force?: boolean }): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD || !env.FEEDGEN_PUBLISHER_DID) {
    console.log("[auto-follow] Missing credentials — skipping.");
    return;
  }

  const settings = await getAutoFollowSettings(env);

  if (!settings.enabled && !options?.force) return;

  if (!options?.force && settings.lastRun) {
    const lastRunMs = new Date(settings.lastRun).getTime();
    const intervalMs = settings.intervalDays * 24 * 60 * 60 * 1000;
    if (Date.now() - lastRunMs < intervalMs) {
      console.log(`[auto-follow] Not due yet. Next run after ${new Date(lastRunMs + intervalMs).toISOString()}`);
      return;
    }
  }

  console.log(
    `[auto-follow] Scanning markets=${settings.markets.join(",")}, cap=${settings.cap}, ` +
    `followers=${settings.minFollowers}–${settings.maxFollowers}, minPosts=${settings.minPosts}`,
  );

  await ensureFollowQueueTable(env);

  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });

  // Build set of DIDs we already follow
  const alreadyFollowing = new Set<string>();
  let followCursor: string | undefined;
  do {
    const result = await agent.getFollows({ actor: env.FEEDGEN_PUBLISHER_DID, limit: 100, cursor: followCursor });
    for (const f of result.data.follows) alreadyFollowing.add(f.did);
    followCursor = result.data.cursor;
  } while (followCursor && alreadyFollowing.size < 10_000);

  // Build set of DIDs already in our follow log (followed or pending unfollow)
  const alreadyLogged = new Set<string>();
  try {
    const logRows = await env.DB.prepare(
      "SELECT did FROM auto_follow_log WHERE follow_back_status IN ('pending', 'followed')",
    ).all<{ did: string }>();
    for (const r of logRows.results) alreadyLogged.add(r.did);
  } catch {}

  // Also skip DIDs currently pending in the queue
  try {
    const queueRows = await env.DB.prepare(
      "SELECT did FROM auto_follow_queue WHERE status = 'pending'",
    ).all<{ did: string }>();
    for (const r of queueRows.results) alreadyLogged.add(r.did);
  } catch {}

  const candidates: Array<{ did: string; handle: string; followersCount: number; market: string }> = [];
  const seenDids = new Set<string>();

  for (const market of settings.markets) {
    const keywords = MARKET_KEYWORDS[market] ?? ["technology", "business"];
    // Pick 2 random keywords per market to vary discovery
    const shuffled = keywords.sort(() => Math.random() - 0.5).slice(0, 2);

    for (const kw of shuffled) {
      try {
        const result = await agent.app.bsky.feed.searchPosts({ q: kw, limit: 25, sort: "latest" });
        for (const post of result.data.posts) {
          const author = post.author;
          if (seenDids.has(author.did)) continue;
          if (alreadyFollowing.has(author.did)) continue;
          if (alreadyLogged.has(author.did)) continue;
          if (author.did === env.FEEDGEN_PUBLISHER_DID) continue;

          const followers = Number(author.followersCount ?? 0);
          const posts = Number(author.postsCount ?? 0);

          // Quality gate
          if (followers < settings.minFollowers) continue;
          if (settings.maxFollowers > 0 && followers > settings.maxFollowers) continue;
          if (posts < settings.minPosts) continue;

          seenDids.add(author.did);
          candidates.push({ did: author.did, handle: author.handle, followersCount: followers, market });

          if (candidates.length >= settings.cap) break;
        }
      } catch (err) {
        console.warn(`[auto-follow] Search failed for "${kw}":`, err instanceof Error ? err.message : String(err));
      }

      if (candidates.length >= settings.cap) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (candidates.length >= settings.cap) break;
  }

  const toQueue = candidates.slice(0, settings.cap);
  const { enqueued, skipped } = await enqueueFollowItems(env, toQueue);

  await setSetting(env, "auto_follow_last_run", new Date().toISOString());

  console.log(
    `[auto-follow] Discovered ${candidates.length} candidates, queued ${enqueued} (${skipped} skipped). ` +
    `Will follow at ~160/hr via cron.`,
  );
}
