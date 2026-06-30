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

  // Fetch our first 3,000 following to avoid re-following (30 API calls, ~3s)
  const alreadyFollowing = new Set<string>();
  let followCursor: string | undefined;
  do {
    const result = await agent.getFollows({ actor: env.FEEDGEN_PUBLISHER_DID, limit: 100, cursor: followCursor });
    for (const f of result.data.follows) alreadyFollowing.add(f.did);
    followCursor = result.data.cursor;
  } while (followCursor && alreadyFollowing.size < 3_000);

  // Fetch logged/queued DIDs so we don't re-queue
  const alreadyLogged = new Set<string>();
  try {
    const logRows = await env.DB.prepare(
      "SELECT did FROM auto_follow_log WHERE follow_back_status IN ('pending','followed')",
    ).all<{ did: string }>();
    for (const r of logRows.results) alreadyLogged.add(r.did);

    const qRows = await env.DB.prepare(
      "SELECT did FROM auto_follow_queue WHERE status = 'pending'",
    ).all<{ did: string }>();
    for (const r of qRows.results) alreadyLogged.add(r.did);
  } catch {}

  // Pick one random market + keyword per tick for discovery variety
  const market = settings.markets[Math.floor(Math.random() * settings.markets.length)] ?? "usa";
  const keywords = MARKET_KEYWORDS[market] ?? ["technology"];
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];

  const candidates: Array<{ did: string; handle: string; followersCount: number; market: string }> = [];
  const seenDids = new Set<string>();

  try {
    const result = await agent.app.bsky.feed.searchPosts({ q: keyword, limit: 50, sort: "latest" });
    for (const post of result.data.posts) {
      const author = post.author;
      if (seenDids.has(author.did) || alreadyFollowing.has(author.did) || alreadyLogged.has(author.did)) continue;
      if (author.did === env.FEEDGEN_PUBLISHER_DID) continue;

      const followers = Number(author.followersCount ?? 0);
      const posts    = Number(author.postsCount ?? 0);
      if (followers < settings.minFollowers) continue;
      if (settings.maxFollowers > 0 && followers > settings.maxFollowers) continue;
      if (posts < settings.minPosts) continue;

      seenDids.add(author.did);
      candidates.push({ did: author.did, handle: author.handle, followersCount: followers, market });
      if (candidates.length >= DISCOVER_PER_TICK) break;
    }
  } catch (err) {
    console.warn(`[auto-follow] Search failed "${keyword}":`, err instanceof Error ? err.message : String(err));
  }

  const { enqueued } = await enqueueFollowItems(env, candidates);
  console.log(`[auto-follow] market=${market} kw="${keyword}" → ${enqueued} queued. Total followed: ${settings.totalFollowed}, cap=${settings.cap || "∞"}`);
}
