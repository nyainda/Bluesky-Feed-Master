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

// Candidates to discover per cron tick — keeps the queue fed without bursting
const DISCOVER_PER_TICK = 25;

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
  cap: number;
  markets: string[];
  minFollowers: number;
  maxFollowers: number;
  minPosts: number;
  followbackDays: number;
  totalFollowed: number;
}> {
  const [enabled, cap, markets, minFollowers, maxFollowers, minPosts, followbackDays] =
    await Promise.all([
      getSetting(env, "auto_follow_enabled", "0"),
      getSetting(env, "auto_follow_cap", "0"),        // 0 = unlimited (run forever)
      getSetting(env, "auto_follow_markets", '["usa","europe","uk"]'),
      getSetting(env, "auto_follow_min_followers", "100"),
      getSetting(env, "auto_follow_max_followers", "50000"),
      getSetting(env, "auto_follow_min_posts", "5"),
      getSetting(env, "auto_follow_followback_days", "7"),
    ]);

  let parsedMarkets: string[] = ["usa", "europe", "uk"];
  try { parsedMarkets = JSON.parse(markets); } catch {}

  let totalFollowed = 0;
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM auto_follow_log").first<{ cnt: number }>();
    totalFollowed = Number(row?.cnt ?? 0);
  } catch {}

  return {
    enabled: enabled === "1",
    cap: Math.max(0, parseInt(cap, 10) || 0),
    markets: parsedMarkets,
    minFollowers: Math.max(0, parseInt(minFollowers, 10) || 100),
    maxFollowers: Math.max(0, parseInt(maxFollowers, 10) || 50_000),
    minPosts: Math.max(0, parseInt(minPosts, 10) || 5),
    followbackDays: Math.max(1, parseInt(followbackDays, 10) || 7),
    totalFollowed,
  };
}

export async function saveAutoFollowSettings(env: Env, settings: {
  enabled?: boolean;
  cap?: number;
  markets?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  minPosts?: number;
  followbackDays?: number;
}): Promise<void> {
  const writes: Promise<void>[] = [];
  if (settings.enabled !== undefined)        writes.push(setSetting(env, "auto_follow_enabled", settings.enabled ? "1" : "0"));
  if (settings.cap !== undefined)            writes.push(setSetting(env, "auto_follow_cap", String(settings.cap)));
  if (settings.markets !== undefined)        writes.push(setSetting(env, "auto_follow_markets", JSON.stringify(settings.markets)));
  if (settings.minFollowers !== undefined)   writes.push(setSetting(env, "auto_follow_min_followers", String(settings.minFollowers)));
  if (settings.maxFollowers !== undefined)   writes.push(setSetting(env, "auto_follow_max_followers", String(settings.maxFollowers)));
  if (settings.minPosts !== undefined)       writes.push(setSetting(env, "auto_follow_min_posts", String(settings.minPosts)));
  if (settings.followbackDays !== undefined) writes.push(setSetting(env, "auto_follow_followback_days", String(settings.followbackDays)));
  await Promise.all(writes);
}

/**
 * Runs every cron tick (every 3 minutes). Discovers DISCOVER_PER_TICK new quality
 * accounts from a random market keyword and adds them to the follow queue.
 *
 * No intervalDays gate — runs continuously forever (cap=0) or until cap is reached.
 * runScheduledFollow drains the queue at 10 follows/tick (~4,800/day, under Bluesky's 5k limit).
 * runFollowBackCheck checks 5 accounts/tick for follow-back after followbackDays.
 */
export async function runAutoFollow(env: Env, options?: { force?: boolean }): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD || !env.FEEDGEN_PUBLISHER_DID) return;

  const settings = await getAutoFollowSettings(env);

  // Respect the enabled toggle — skip discovery unless force-triggered
  if (!settings.enabled && !options?.force) {
    console.log("[auto-follow] Disabled via settings — skipping discovery");
    return;
  }

  // Stop discovery if hard cap reached (0 = unlimited)
  if (settings.cap > 0 && settings.totalFollowed >= settings.cap) {
    console.log(`[auto-follow] Cap reached (${settings.totalFollowed}/${settings.cap}) — paused`);
    return;
  }

  await ensureFollowQueueTable(env);

  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });

  // Skip the slow 3k-following API fetch — with 51k+ following it only covers 6% and
  // wastes 30 API calls. Rely on the DB log instead; enqueueFollowItems uses
  // ON CONFLICT DO NOTHING so duplicate queue entries are already guarded, and
  // runScheduledFollow skips accounts already in auto_follow_log.
  const alreadyLogged = new Set<string>();
  try {
    const [logRows, qRows] = await Promise.all([
      env.DB.prepare(
        "SELECT did FROM auto_follow_log WHERE follow_back_status IN ('pending','followed')",
      ).all<{ did: string }>(),
      env.DB.prepare(
        "SELECT did FROM auto_follow_queue WHERE status IN ('pending','processing','done')",
      ).all<{ did: string }>(),
    ]);
    for (const r of logRows.results) alreadyLogged.add(r.did);
    for (const r of qRows.results) alreadyLogged.add(r.did);
  } catch {}

  // Search 3 different keywords per run (across potentially different markets) so
  // each tick finds a more diverse set of fresh accounts even when the log is large.
  const market = settings.markets[Math.floor(Math.random() * settings.markets.length)] ?? "usa";
  const marketKeywords = MARKET_KEYWORDS[market] ?? ["technology"];

  // Pick 3 distinct keywords from this market (cycle through them)
  const shuffled = [...marketKeywords].sort(() => Math.random() - 0.5);
  const keywordsToTry = shuffled.slice(0, Math.min(3, shuffled.length));

  const candidates: Array<{ did: string; handle: string; followersCount: number; market: string }> = [];
  const seenDids = new Set<string>();

  for (const keyword of keywordsToTry) {
    if (candidates.length >= DISCOVER_PER_TICK) break;
    try {
      const result = await agent.app.bsky.feed.searchPosts({ q: keyword, limit: 100, sort: "latest" });
      for (const post of result.data.posts) {
        if (candidates.length >= DISCOVER_PER_TICK) break;
        const author = post.author;
        if (seenDids.has(author.did) || alreadyLogged.has(author.did)) continue;
        if (author.did === env.FEEDGEN_PUBLISHER_DID) continue;

        const followers = Number(author.followersCount ?? 0);
        const posts    = Number(author.postsCount ?? 0);
        if (followers < settings.minFollowers) continue;
        if (settings.maxFollowers > 0 && followers > settings.maxFollowers) continue;
        if (posts < settings.minPosts) continue;

        seenDids.add(author.did);
        candidates.push({ did: author.did, handle: author.handle, followersCount: followers, market });
      }
    } catch (err) {
      console.warn(`[auto-follow] Search failed "${keyword}":`, err instanceof Error ? err.message : String(err));
    }
  }

  const { enqueued } = await enqueueFollowItems(env, candidates);
  console.log(`[auto-follow] market=${market} kw=${JSON.stringify(keywordsToTry)} → found ${candidates.length}, enqueued ${enqueued}. Total followed: ${settings.totalFollowed}, cap=${settings.cap || "∞"}`);
}
