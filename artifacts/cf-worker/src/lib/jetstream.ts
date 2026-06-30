/**
 * Jetstream Indexer — replaces search-API polling with AT Protocol firehose.
 *
 * Every cron tick: open WebSocket to Jetstream, collect posts for COLLECT_MS,
 * filter in-memory against all active feed keywords, bulk-upsert matches into D1.
 * A cursor (Unix microseconds) in cron_settings ensures each tick resumes exactly
 * where the last one left off — no gaps, no re-processing.
 *
 * Advantages over searchPosts polling:
 *   • No Bluesky search rate limits (separate quota)
 *   • Captures ALL matching posts, not just popular/recent ones
 *   • Processes all feeds in one pass — no per-feed API calls
 *   • Much faster per-tick
 *
 * Cost: FREE — Jetstream is hosted by Bluesky, no CF add-ons required.
 * Endpoint: wss://jetstream2.us-east.bsky.network/subscribe
 */

import type { Env } from "../index";
import { createDb, feedsTable, keywordsTable, indexedPostsTable } from "../db";
import { eq } from "drizzle-orm";
import { markAuthorDirty } from "./author-scoring";

const JETSTREAM_URL = "wss://jetstream2.us-east.bsky.network/subscribe";
const COLLECT_MS = 20_000;  // collect for 20 seconds per cron tick
const MAX_EVENTS = 3_000;   // hard cap to prevent memory blowup on firehose bursts

type JetstreamEvent = {
  did: string;
  time_us: number;
  kind: string;
  commit?: {
    operation: string;
    collection: string;
    rkey: string;
    cid: string;
    record?: {
      $type?: string;
      text?: string;
      createdAt?: string;
      langs?: string[];
    };
  };
};

export async function runJetstreamIndexer(
  env: Env,
): Promise<{ indexed: number; matched: number; events: number }> {
  const db = createDb(env.DB);

  // ── Phase 1: Load feed + keyword config from D1 ───────────────────────────────
  const feeds = await db.select().from(feedsTable).where(eq(feedsTable.isActive, true));
  if (feeds.length === 0) return { indexed: 0, matched: 0, events: 0 };

  const allKeywords = await db.select().from(keywordsTable);

  // Build keyword (lowercase) → algoTag[] map for fast in-memory filtering
  const feedMap = new Map(feeds.map((f) => [f.id, f]));
  const keywordIndex = new Map<string, string[]>();

  for (const kw of allKeywords) {
    const feed = feedMap.get(kw.feedId);
    if (!feed?.isActive) continue;
    const key = kw.keyword.toLowerCase().trim();
    if (!keywordIndex.has(key)) keywordIndex.set(key, []);
    keywordIndex.get(key)!.push(feed.recordName);
  }

  if (keywordIndex.size === 0) {
    console.log("[jetstream] No keywords configured — skipping.");
    return { indexed: 0, matched: 0, events: 0 };
  }

  // ── Phase 2: Load stored cursor ───────────────────────────────────────────────
  const cursorRow = await env.DB
    .prepare("SELECT value FROM cron_settings WHERE key = 'jetstream_cursor'")
    .first<{ value: string }>();
  const cursor = cursorRow?.value ?? null;

  // ── Phase 3: Connect to Jetstream and collect events ─────────────────────────
  const url = new URL(JETSTREAM_URL);
  url.searchParams.set("wantedCollections", "app.bsky.feed.post");
  if (cursor) url.searchParams.set("cursor", cursor);

  const events: JetstreamEvent[] = [];
  let lastTimeUs: number | null = null;

  try {
    const ws = new WebSocket(url.toString());

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        resolve();
      }, COLLECT_MS);

      ws.addEventListener("message", (evt) => {
        try {
          const data = JSON.parse(evt.data as string) as JetstreamEvent;
          if (
            data.kind === "commit" &&
            data.commit?.operation === "create" &&
            data.commit?.collection === "app.bsky.feed.post" &&
            data.commit?.record?.$type === "app.bsky.feed.post"
          ) {
            events.push(data);
            if (data.time_us) lastTimeUs = data.time_us;
          }
          if (events.length >= MAX_EVENTS) {
            clearTimeout(timer);
            try { ws.close(); } catch { /* ignore */ }
            resolve();
          }
        } catch { /* malformed JSON — skip */ }
      });

      ws.addEventListener("close", () => { clearTimeout(timer); resolve(); });
      ws.addEventListener("error", () => { clearTimeout(timer); resolve(); });
    });
  } catch (err) {
    console.error("[jetstream] WebSocket connection failed:", err);
    return { indexed: 0, matched: 0, events: 0 };
  }

  console.log(`[jetstream] Collected ${events.length} events (cursor=${cursor ? "stored" : "latest"})`);
  if (events.length === 0) return { indexed: 0, matched: 0, events: 0 };

  // ── Phase 4: Filter events against keyword index ──────────────────────────────
  type MatchedPost = {
    uri: string; cid: string; author: string; text: string;
    createdAt: string; algoTags: Set<string>;
  };

  const matchedByUri = new Map<string, MatchedPost>();

  for (const event of events) {
    const record = event.commit?.record;
    if (!record?.text) continue;

    const text = record.text;
    const textLower = text.toLowerCase();
    const uri = `at://${event.did}/app.bsky.feed.post/${event.commit!.rkey}`;
    const matchingTags = new Set<string>();

    for (const [keyword, algoTags] of keywordIndex) {
      if (textLower.includes(keyword) || textLower.includes(`#${keyword}`)) {
        for (const tag of algoTags) matchingTags.add(tag);
      }
    }

    if (matchingTags.size === 0) continue;

    if (matchedByUri.has(uri)) {
      for (const tag of matchingTags) matchedByUri.get(uri)!.algoTags.add(tag);
    } else {
      matchedByUri.set(uri, {
        uri,
        cid: event.commit!.cid,
        author: event.did,
        text,
        createdAt: record.createdAt ?? new Date(Math.round(event.time_us / 1_000)).toISOString(),
        algoTags: matchingTags,
      });
    }
  }

  const matched = matchedByUri.size;
  console.log(`[jetstream] ${matched} posts matched across ${keywordIndex.size} keywords`);

  // ── Phase 5: Upsert matched posts — simple raw SQL for reliability ────────────
  let indexed = 0;
  const now = new Date().toISOString();

  for (const post of matchedByUri.values()) {
    const algoTagsStr = [...post.algoTags].join(",");
    try {
      // Use raw D1 SQL: on conflict merge algo_tags without duplication
      // The instr check avoids adding a tag that's already present.
      // For multiple new tags we just append the full joined string — duplicates
      // are deduplicated at read-time by the feed skeleton query (GROUP BY uri).
      await env.DB
        .prepare(
          `INSERT INTO indexed_posts (uri, cid, author, text, algo_tags, indexed_at, likes, reposts, replies, quotes)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0)
           ON CONFLICT(uri) DO UPDATE SET
             algo_tags = CASE
               WHEN instr(',' || algo_tags || ',', ',' || ? || ',') > 0
               THEN algo_tags
               ELSE algo_tags || ',' || ?
             END,
             engagement_synced_at = ?`
        )
        .bind(post.uri, post.cid, post.author, post.text, algoTagsStr, now, algoTagsStr, algoTagsStr, now)
        .run();
      await markAuthorDirty(env, post.author);
      indexed++;
    } catch (err) {
      console.error("[jetstream] Insert failed for", post.uri.slice(-20), err);
    }
  }

  // ── Phase 6: Save cursor so next tick resumes here ────────────────────────────
  if (lastTimeUs !== null) {
    await env.DB
      .prepare(
        "INSERT INTO cron_settings (key, value) VALUES ('jetstream_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
      )
      .bind(String(lastTimeUs))
      .run()
      .catch(() => { /* non-fatal */ });
  }

  console.log(`[jetstream] Done — ${indexed} indexed, ${matched} matched, ${events.length} events`);
  return { indexed, matched, events: events.length };
}
