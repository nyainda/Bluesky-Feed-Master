/**
 * Jetstream Indexer — replaces search-API polling with AT Protocol firehose.
 *
 * Every cron tick:
 *   1. Opens WebSocket to Jetstream, collects for COLLECT_MS
 *   2. Filters app.bsky.feed.post events against feed keywords → upserts to D1
 *   3. Filters app.bsky.graph.follow events targeting our DID → queues for follow-back
 *   4. Queues matched post authors for auto-follow (if auto-follow is enabled)
 *      — highest-quality signal: these accounts actively post content matching
 *        your feeds, so they're ideal follow targets. No search-API call needed.
 *
 * A cursor (Unix microseconds) in cron_settings ensures each tick resumes exactly
 * where the last one left off — no gaps, no re-processing.
 *
 * Cost: FREE — Jetstream is hosted by Bluesky, no CF add-ons required.
 * Endpoint: wss://jetstream2.us-east.bsky.network/subscribe
 */

import type { Env } from "../index";
import { createDb, feedsTable, keywordsTable, indexedPostsTable } from "../db";
import { eq } from "drizzle-orm";
import { batchMarkAuthorsDirty } from "./author-scoring";
import { enqueueFollowItems, ensureFollowQueueTable } from "./scheduled-follow";

// Max authors to queue per tick — keeps queue growth predictable (~25 × 480 ticks/day = 12K/day candidates)
const MAX_AUTHORS_PER_TICK = 25;

/**
 * Merge new algo tags into an existing comma-separated tag string.
 * Checks and appends per-tag (not as a blob) to prevent duplicates like
 * "tech,tech,startups" when a post is re-indexed across multiple passes.
 */
function mergeAlgoTags(existing: string | null, newTags: Set<string>): string {
  const existingSet = new Set(
    (existing ?? "").split(",").map((t) => t.trim()).filter(Boolean),
  );
  for (const tag of newTags) existingSet.add(tag);
  return [...existingSet].join(",");
}

const JETSTREAM_URL = "wss://jetstream2.us-east.bsky.network/subscribe";
const COLLECT_MS = 20_000;   // collect for 20 seconds per cron tick
const MAX_EVENTS = 20_000;   // raised from 5k — handles burst catch-up without memory issues

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
      // Post fields
      text?: string;
      createdAt?: string;
      langs?: string[];
      // Follow fields
      subject?: string;
    };
  };
};

export async function runJetstreamIndexer(
  env: Env,
): Promise<{ indexed: number; matched: number; events: number; newFollowers: number; authorsQueued: number }> {
  const db = createDb(env.DB);

  // ── Phase 1: Load feed + keyword config from D1 ───────────────────────────────
  const feeds = await db.select().from(feedsTable).where(eq(feedsTable.isActive, true));

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

  const hasKeywords = keywordIndex.size > 0;
  const publisherDid = env.FEEDGEN_PUBLISHER_DID ?? "";

  // Skip entirely only if no keywords AND no publisher DID (nothing useful to do)
  if (!hasKeywords && !publisherDid) {
    console.log("[jetstream] No keywords and no publisher DID — skipping.");
    return { indexed: 0, matched: 0, events: 0, newFollowers: 0, authorsQueued: 0 };
  }

  // ── Phase 2: Load stored cursor ───────────────────────────────────────────────
  const cursorRow = await env.DB
    .prepare("SELECT value FROM cron_settings WHERE key = 'jetstream_cursor'")
    .first<{ value: string }>();
  const cursor = cursorRow?.value ?? null;

  // ── Phase 3: Connect to Jetstream and collect events ─────────────────────────
  const url = new URL(JETSTREAM_URL);
  // Subscribe to posts (for feed indexing) AND follows (for instant follow-back)
  url.searchParams.append("wantedCollections", "app.bsky.feed.post");
  url.searchParams.append("wantedCollections", "app.bsky.graph.follow");
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
          if (data.kind === "commit") {
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
    return { indexed: 0, matched: 0, events: 0, newFollowers: 0, authorsQueued: 0 };
  }

  console.log(`[jetstream] Collected ${events.length} events (cursor=${cursor ? "stored" : "latest"})`);

  // Always save lastRun even on 0 events so dashboard shows "Active" instead of "Waiting"
  if (events.length === 0) {
    await env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES ('jetstream_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    ).bind(new Date().toISOString()).run().catch(() => {});
    return { indexed: 0, matched: 0, events: 0, newFollowers: 0, authorsQueued: 0 };
  }

  // ── Phase 4a: Filter post events against keyword index ────────────────────────
  type MatchedPost = {
    uri: string; cid: string; author: string; text: string;
    createdAt: string; algoTags: Set<string>;
  };

  const matchedByUri = new Map<string, MatchedPost>();

  // Fast single-regex pre-filter, built once per invocation (not per event).
  // Jetstream's app.bsky.feed.post collection is the ENTIRE network firehose —
  // thousands of posts per tick, almost none of which match any keyword. Running
  // the full keywordIndex loop (O(keywords) string.includes calls) against every
  // single one of those posts synchronously was blowing the Worker CPU-time
  // limit. A single compiled regex reduces the common (non-matching) case to one
  // cheap O(1) test; the expensive per-keyword loop only runs on actual hits.
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nonEmptyKeywords = [...keywordIndex.keys()].filter((k) => k.length > 0);
  const quickTestRegex = hasKeywords && nonEmptyKeywords.length > 0
    ? new RegExp(nonEmptyKeywords.map(escapeRegex).join("|"), "i")
    : null;

  if (hasKeywords && quickTestRegex) {
    for (const event of events) {
      if (
        event.commit?.operation !== "create" ||
        event.commit?.collection !== "app.bsky.feed.post" ||
        event.commit?.record?.$type !== "app.bsky.feed.post"
      ) continue;

      const record = event.commit.record;
      if (!record?.text) continue;

      const text = record.text;

      // Fast reject: skip the expensive per-keyword loop entirely for the
      // overwhelming majority of firehose posts that match nothing.
      if (!quickTestRegex.test(text)) continue;

      const textLower = text.toLowerCase();
      const uri = `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`;
      const matchingTags = new Set<string>();

      for (const [keyword, algoTags] of keywordIndex) {
        if (textLower.includes(keyword) || textLower.includes(`#${keyword}`)) {
          for (const tag of algoTags) matchingTags.add(tag);
        }
      }

      if (matchingTags.size === 0) continue;

      // ── Quality gate: skip obvious spam / low-quality posts ─────────────
      // Short posts (<20 chars) are almost never feed-worthy content
      if (text.trim().length < 20) continue;
      // Skip posts that are almost entirely hashtags / mentions (spammy)
      const wordCount = text.trim().split(/\s+/).length;
      const hashtagCount = (text.match(/#\w+/g) ?? []).length;
      if (wordCount > 2 && hashtagCount / wordCount > 0.6) continue;

      if (matchedByUri.has(uri)) {
        for (const tag of matchingTags) matchedByUri.get(uri)!.algoTags.add(tag);
      } else {
        matchedByUri.set(uri, {
          uri,
          cid: event.commit.cid,
          author: event.did,
          text,
          createdAt: record.createdAt ?? new Date(Math.round(event.time_us / 1_000)).toISOString(),
          algoTags: matchingTags,
        });
      }
    }
  }

  const matched = matchedByUri.size;
  console.log(`[jetstream] ${matched} posts matched across ${keywordIndex.size} keywords`);

  // ── Phase 4b: Filter follow events targeting our DID ─────────────────────────
  const newFollowerDids: string[] = [];

  if (publisherDid) {
    for (const event of events) {
      if (
        event.commit?.operation !== "create" ||
        event.commit?.collection !== "app.bsky.graph.follow" ||
        event.commit?.record?.$type !== "app.bsky.graph.follow"
      ) continue;

      const subject = event.commit.record?.subject;
      if (!subject || subject !== publisherDid) continue;
      if (event.did === publisherDid) continue; // ignore self-follow

      newFollowerDids.push(event.did);
    }

    if (newFollowerDids.length > 0) {
      console.log(`[jetstream] ${newFollowerDids.length} new followers detected — queuing follow-back`);
    }
  }

  // ── Phase 5a: Batch upsert matched posts ─────────────────────────────────────
  // One SELECT for all matched URIs (not one per post), then one DB.batch() for
  // all writes. Reduces 2N sequential D1 round trips to 2 total.
  let indexed = 0;
  const now = new Date().toISOString();
  const dirtyAuthorDids: string[] = [];
  const matchedPosts = [...matchedByUri.values()];

  if (matchedPosts.length > 0) {
    // Batch-fetch existing algo_tags for all matched URIs in one round trip
    const uris = matchedPosts.map((p) => p.uri);
    const placeholders = uris.map(() => "?").join(",");
    let existingTagsByUri = new Map<string, string | null>();
    try {
      const existingRows = await env.DB
        .prepare(`SELECT uri, algo_tags FROM indexed_posts WHERE uri IN (${placeholders})`)
        .bind(...uris)
        .all<{ uri: string; algo_tags: string | null }>();
      existingTagsByUri = new Map(existingRows.results.map((r) => [r.uri, r.algo_tags]));
    } catch {
      // Non-fatal — fall back to treating all posts as new (no tag merging)
    }

    // Build all write statements, merging tags in JS (not per-post awaits)
    const writeStmts = matchedPosts.map((post) => {
      const mergedTags = mergeAlgoTags(existingTagsByUri.get(post.uri) ?? null, post.algoTags);
      dirtyAuthorDids.push(post.author);
      // Use the post's actual Bluesky createdAt so "39min ago" reflects the real post age,
      // not when FeedForge happened to index it.
      const postCreatedAt = post.createdAt ?? now;
      return env.DB.prepare(
        `INSERT INTO indexed_posts (uri, cid, author, text, algo_tags, indexed_at, likes, reposts, replies, quotes)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0)
         ON CONFLICT(uri) DO UPDATE SET
           algo_tags = ?,
           engagement_synced_at = ?`,
      ).bind(post.uri, post.cid, post.author, post.text, mergedTags, postCreatedAt, mergedTags, now);
    });

    try {
      await env.DB.batch(writeStmts);
      indexed = matchedPosts.length;
    } catch (err) {
      console.error("[jetstream] Batch insert failed:", err);
    }
  }

  // Batch all author-dirty marks in one D1 write instead of one per post
  if (dirtyAuthorDids.length > 0) {
    await batchMarkAuthorsDirty(env, dirtyAuthorDids).catch(() => {});
  }

  // ── Phase 5b: Queue new followers for immediate follow-back ───────────────────
  let newFollowers = 0;
  if (newFollowerDids.length > 0) {
    try {
      await ensureFollowQueueTable(env);

      // Check which DIDs are already queued or logged so we don't duplicate
      const existingRows = await env.DB
        .prepare(
          `SELECT did FROM auto_follow_queue WHERE did IN (${newFollowerDids.map(() => "?").join(",")})
           UNION
           SELECT did FROM auto_follow_log WHERE did IN (${newFollowerDids.map(() => "?").join(",")})`
        )
        .bind(...newFollowerDids, ...newFollowerDids)
        .all<{ did: string }>();

      const alreadyTracked = new Set(existingRows.results.map((r) => r.did));
      const toQueue = newFollowerDids.filter((d) => !alreadyTracked.has(d));

      if (toQueue.length > 0) {
        const stmts = toQueue.map((did) =>
          env.DB.prepare(
            `INSERT INTO auto_follow_queue (did, handle, followers_count, market)
             VALUES (?, '', 0, 'jetstream')
             ON CONFLICT(did) DO NOTHING`
          ).bind(did)
        );
        await env.DB.batch(stmts);
        newFollowers = toQueue.length;
        console.log(`[jetstream] Queued ${newFollowers} new followers for follow-back`);
      }
    } catch (err) {
      console.error("[jetstream] Failed to queue followers:", err);
    }
  }

  // ── Phase 5c: Queue matched post authors for auto-follow ─────────────────────
  // Best-quality signal: these accounts actively publish content matching your
  // feed keywords — far better than random searchPosts discovery.
  // Only runs when auto-follow is enabled; respects existing queue/log dedup.
  let authorsQueued = 0;
  if (matchedPosts.length > 0) {
    try {
      const autoFollowRow = await env.DB
        .prepare("SELECT value FROM cron_settings WHERE key = 'auto_follow_enabled'")
        .first<{ value: string }>();
      const autoFollowEnabled = autoFollowRow?.value === "1";

      if (autoFollowEnabled) {
        // Unique author DIDs from this tick's matched posts, excluding ourselves
        const candidateDids = [...new Set(matchedPosts.map(p => p.author))]
          .filter(did => did !== publisherDid)
          .slice(0, MAX_AUTHORS_PER_TICK);

        if (candidateDids.length > 0) {
          await ensureFollowQueueTable(env);

          // Single-query dedup against both queue and follow log
          const placeholders = candidateDids.map(() => "?").join(",");
          const existingRows = await env.DB
            .prepare(
              `SELECT did FROM auto_follow_queue WHERE did IN (${placeholders})
               UNION
               SELECT did FROM auto_follow_log WHERE did IN (${placeholders})`
            )
            .bind(...candidateDids, ...candidateDids)
            .all<{ did: string }>();

          const alreadyTracked = new Set(existingRows.results.map(r => r.did));
          const toQueue = candidateDids.filter(did => !alreadyTracked.has(did));

          if (toQueue.length > 0) {
            const items = toQueue.map(did => ({
              did,
              handle: "",
              followersCount: -1,   // quality check deferred to follow-time via getProfile()
              market: "jetstream",  // distinct market tag so you can track this source
            }));
            const result = await enqueueFollowItems(env, items);
            authorsQueued = result.enqueued;
            if (authorsQueued > 0) {
              console.log(`[jetstream] Queued ${authorsQueued} post authors for auto-follow`);
            }
          }
        }
      }
    } catch (err) {
      console.error("[jetstream] Failed to queue post authors for follow:", err);
    }
  }

  // ── Phase 6: Save cursor + stats so cron-health can surface them ─────────────
  const saveStmts = [
    env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES ('jetstream_last_indexed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    ).bind(String(indexed)),
    env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES ('jetstream_last_events', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    ).bind(String(events.length)),
    env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES ('jetstream_last_followers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    ).bind(String(newFollowers)),
    env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES ('jetstream_last_authors_queued', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    ).bind(String(authorsQueued)),
    env.DB.prepare(
      "INSERT INTO cron_settings (key, value) VALUES ('jetstream_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    ).bind(new Date().toISOString()),
  ];
  if (lastTimeUs !== null) {
    saveStmts.push(
      env.DB.prepare(
        "INSERT INTO cron_settings (key, value) VALUES ('jetstream_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
      ).bind(String(lastTimeUs))
    );
  }
  await env.DB.batch(saveStmts).catch(() => { /* non-fatal */ });

  console.log(`[jetstream] Done — ${indexed} indexed, ${matched} matched, ${events.length} events, ${newFollowers} followers, ${authorsQueued} authors queued`);
  return { indexed, matched, events: events.length, newFollowers, authorsQueued };
}
