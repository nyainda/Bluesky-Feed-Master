/**
 * Feed Boost — posts a promotional Bluesky update about a feed on a weekly schedule.
 *
 * Settings stored in cron_settings as JSON under key `feed_boost_<feedId>`.
 * Shape: { enabled, dayOfWeek (0=Sun…6=Sat), hourUtc (0–23), template?, lastBoostedAt? }
 *
 * The boost fires when:
 *   1. enabled === true
 *   2. today's UTC weekday === dayOfWeek
 *   3. current UTC hour === hourUtc
 *   4. lastBoostedAt is null OR more than 6 days ago  (prevents double-fire within same tick window)
 */

import { AtpAgent, RichText } from "@atproto/api";
import { createDb, feedsTable } from "../db";
import { eq } from "drizzle-orm";
import type { Env } from "../index";

export interface FeedBoostSettings {
  enabled: boolean;
  dayOfWeek: number;
  hourUtc: number;
  template: string | null;
  lastBoostedAt: string | null;
}

const DEFAULT_SETTINGS: FeedBoostSettings = {
  enabled: false,
  dayOfWeek: 1,
  hourUtc: 9,
  template: null,
  lastBoostedAt: null,
};

export function boostSettingsKey(feedId: number) {
  return `feed_boost_${feedId}`;
}

export async function getBoostSettings(env: Env, feedId: number): Promise<FeedBoostSettings> {
  const row = await env.DB
    .prepare("SELECT value FROM cron_settings WHERE key = ?")
    .bind(boostSettingsKey(feedId))
    .first<{ value: string }>();
  if (!row?.value) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveBoostSettings(env: Env, feedId: number, settings: FeedBoostSettings): Promise<void> {
  const key = boostSettingsKey(feedId);
  const value = JSON.stringify(settings);
  await env.DB
    .prepare("INSERT INTO cron_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')")
    .bind(key, value, value)
    .run();
}

function buildBoostText(feed: { displayName: string; description?: string | null; recordName: string }, publisherIdentifier: string, template: string | null): string {
  const url = `https://bsky.app/profile/${publisherIdentifier}/feed/${feed.recordName}`;
  if (template) {
    return template
      .replace(/\{name\}/g, feed.displayName)
      .replace(/\{url\}/g, url)
      .replace(/\{description\}/g, feed.description ?? "");
  }
  const descPart = feed.description ? ` — ${feed.description}` : "";
  return `📡 Check out my custom Bluesky feed: "${feed.displayName}"${descPart}\n\n${url}`;
}

export async function runFeedBoost(env: Env): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) return;

  const now = new Date();
  const todayDow = now.getUTCDay();
  const currentHour = now.getUTCHours();

  const db = createDb(env.DB);
  const feeds = await db
    .select()
    .from(feedsTable)
    .where(eq(feedsTable.isActive, true));

  const publishedFeeds = feeds.filter(f => f.publishedAt);
  if (publishedFeeds.length === 0) return;

  let agent: AtpAgent | null = null;

  for (const feed of publishedFeeds) {
    const settings = await getBoostSettings(env, feed.id);
    if (!settings.enabled) continue;
    if (settings.dayOfWeek !== todayDow) continue;
    if (settings.hourUtc !== currentHour) continue;

    // Prevent double-fire: skip if boosted within the last 6 days
    if (settings.lastBoostedAt) {
      const lastMs = new Date(settings.lastBoostedAt).getTime();
      const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastMs < sixDaysMs) {
        console.log(`[feed-boost] Feed "${feed.recordName}" — already boosted within 6 days, skipping`);
        continue;
      }
    }

    const text = buildBoostText(feed, env.BLUESKY_HANDLE || env.FEEDGEN_PUBLISHER_DID || "", settings.template);

    try {
      if (!agent) {
        agent = new AtpAgent({ service: "https://bsky.social" });
        await agent.login({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });
      }

      const rt = new RichText({ text });
      await rt.detectFacets(agent);
      await agent.post({ text: rt.text, facets: rt.facets });

      await saveBoostSettings(env, feed.id, {
        ...settings,
        lastBoostedAt: now.toISOString(),
      });

      console.log(`[feed-boost] Boosted feed "${feed.recordName}" successfully`);
    } catch (err) {
      console.error(`[feed-boost] Failed to boost feed "${feed.recordName}":`, err instanceof Error ? err.message : String(err));
    }
  }
}
