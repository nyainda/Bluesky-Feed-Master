import type { Env } from "../index";

export interface AutoAmplifySettings {
  enabled: boolean;
  minScore: number;
  maxPerDay: number;
  delayMinutes: number;
}

const DEFAULT_SETTINGS: AutoAmplifySettings = {
  enabled: false,
  minScore: 0.3,
  maxPerDay: 3,
  delayMinutes: 60,
};

export function settingsKey(feedId: number) {
  return `auto_amplify_feed_${feedId}`;
}

export async function getAutoAmplifySettings(env: Env, feedId: number): Promise<AutoAmplifySettings> {
  const row = await env.DB.prepare("SELECT value FROM cron_settings WHERE key = ?")
    .bind(settingsKey(feedId))
    .first<{ value: string }>();
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setAutoAmplifySettings(env: Env, feedId: number, settings: AutoAmplifySettings): Promise<void> {
  const key = settingsKey(feedId);
  const value = JSON.stringify(settings);
  await env.DB.prepare(
    "INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')",
  )
    .bind(key, value, value)
    .run();
}

export async function runAutoAmplify(env: Env): Promise<void> {
  const feeds = await env.DB.prepare(
    "SELECT id, record_name FROM feeds WHERE is_active = 1",
  ).all<{ id: number; record_name: string }>();

  if (!feeds.results?.length) return;

  const today = new Date().toISOString().slice(0, 10);
  const startOfDay = `${today}T00:00:00.000Z`;

  for (const feed of feeds.results) {
    const settings = await getAutoAmplifySettings(env, feed.id);
    if (!settings.enabled) continue;

    const { minScore, maxPerDay, delayMinutes } = settings;

    const todayRow = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM amplification_queue WHERE created_at >= ? AND status IN ('pending', 'done')",
    )
      .bind(startOfDay)
      .first<{ cnt: number }>();
    if ((todayRow?.cnt ?? 0) >= maxPerDay) continue;

    const topPost = await env.DB.prepare(`
      SELECT frp.post_uri, ip.cid, ip.text, frp.final_score
      FROM feed_ranked_posts frp
      JOIN indexed_posts ip ON ip.uri = frp.post_uri
      WHERE frp.feed_id = ?
        AND frp.final_score >= ?
        AND frp.post_uri NOT IN (
          SELECT post_uri FROM amplification_queue
          WHERE created_at >= ? AND status IN ('pending', 'done')
        )
      ORDER BY frp.final_score DESC
      LIMIT 1
    `)
      .bind(feed.id, minScore, startOfDay)
      .first<{ post_uri: string; cid: string; text: string; final_score: number }>();

    if (!topPost) continue;

    const amplifyAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
    await env.DB.prepare(
      "INSERT INTO amplification_queue (post_uri, post_cid, post_text, amplify_at, status) VALUES (?, ?, ?, ?, 'pending')",
    )
      .bind(topPost.post_uri, topPost.cid, topPost.text.slice(0, 300), amplifyAt)
      .run();

    console.log(
      `[auto-amplify] Queued ${topPost.post_uri} for feed ${feed.id} (score=${topPost.final_score.toFixed(3)}) at ${amplifyAt}`,
    );
  }
}
