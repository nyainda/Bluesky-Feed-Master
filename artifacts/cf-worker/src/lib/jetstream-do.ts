/**
 * JetstreamConsumerDO — Durable Object with persistent Jetstream WebSocket.
 *
 * Replaces the cron-tick open→collect→close pattern in jetstream.ts.
 * One WebSocket connection stays open indefinitely; the DO is kept alive by
 * the open socket. Matched posts are buffered in-memory and flushed to D1
 * every 5 seconds via the alarm() handler.
 *
 * Lifecycle:
 *   - Cron tick calls JETSTREAM_DO.get('singleton').fetch('/ping') every 3 min
 *   - On first ping, DO opens WebSocket to Jetstream and schedules alarm
 *   - alarm() flushes buffer → D1, reschedules itself, saves cursor to DO storage
 *   - If DO is evicted, next ping reconnects from saved cursor — no data lost
 */

import { createDb, feedsTable, keywordsTable, indexedPostsTable } from "../db";
import { eq } from "drizzle-orm";
import { markAuthorDirty } from "./author-scoring";
import { ensureFollowQueueTable } from "./scheduled-follow";

const JETSTREAM_URL = "wss://jetstream2.us-east.bsky.network/subscribe";
const FLUSH_INTERVAL_MS = 5_000;
const CONFIG_STALE_MS = 10 * 60 * 1_000; // reload keyword config every 10 min

function mergeAlgoTags(existing: string | null, newTags: Set<string>): string {
  const existingSet = new Set(
    (existing ?? "").split(",").map((t) => t.trim()).filter(Boolean),
  );
  for (const tag of newTags) existingSet.add(tag);
  return [...existingSet].join(",");
}

interface JetstreamEnv {
  DB: D1Database;
  FEEDGEN_PUBLISHER_DID?: string;
}

type BufferedPost = {
  kind: "post";
  uri: string;
  cid: string;
  author: string;
  text: string;
  createdAt: string;
  algoTags: Set<string>;
};

type BufferedFollow = {
  kind: "follow";
  did: string;
};

type BufferedItem = BufferedPost | BufferedFollow;

export class JetstreamConsumerDO {
  private state: DurableObjectState;
  private env: JetstreamEnv;
  private ws: WebSocket | null = null;
  private keywordIndex: Map<string, string[]> = new Map();
  private publisherDid: string;
  private buffer: BufferedItem[] = [];
  private configLoadedAt = 0;
  private lastEventTimeUs: number | null = null;

  constructor(state: DurableObjectState, env: JetstreamEnv) {
    this.state = state;
    this.env = env;
    this.publisherDid = env.FEEDGEN_PUBLISHER_DID ?? "";
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      // Reload config if stale (feeds/keywords may have changed)
      if (Date.now() - this.configLoadedAt > CONFIG_STALE_MS) {
        await this.loadConfig();
      }

      const isAlive =
        this.ws !== null &&
        (this.ws.readyState === WebSocket.CONNECTING ||
          this.ws.readyState === WebSocket.OPEN);

      if (!isAlive) {
        // Start connection without blocking the response
        this.startConnection().catch((err) =>
          console.error("[jetstream-do] Connect error:", err),
        );
      }

      const storedCursor = await this.state.storage.get<string>("cursor");
      const cursorMs = storedCursor
        ? Math.round(Number(storedCursor) / 1_000)
        : null;
      const lagSeconds = cursorMs
        ? Math.round((Date.now() - cursorMs) / 1_000)
        : null;

      return Response.json({
        status: isAlive ? "connected" : "reconnecting",
        bufferSize: this.buffer.length,
        cursorLagSeconds: lagSeconds,
        configKeywords: this.keywordIndex.size,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.flushBuffer();
    // Reschedule only while the WebSocket is alive — if it dropped, the next
    // cron ping will reconnect and re-schedule
    const stillAlive =
      this.ws !== null &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN);
    if (stillAlive) {
      await this.state.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
    }
  }

  private async loadConfig(): Promise<void> {
    const db = createDb(this.env.DB);
    const feeds = await db
      .select()
      .from(feedsTable)
      .where(eq(feedsTable.isActive, true));
    const allKeywords = await db.select().from(keywordsTable);

    const feedMap = new Map(feeds.map((f) => [f.id, f]));
    this.keywordIndex = new Map();

    for (const kw of allKeywords) {
      const feed = feedMap.get(kw.feedId);
      if (!feed?.isActive) continue;
      const key = kw.keyword.toLowerCase().trim();
      if (!this.keywordIndex.has(key)) this.keywordIndex.set(key, []);
      this.keywordIndex.get(key)!.push(feed.recordName);
    }

    this.configLoadedAt = Date.now();
    console.log(
      `[jetstream-do] Config loaded: ${this.keywordIndex.size} keywords, ${feeds.length} feeds`,
    );
  }

  private async startConnection(): Promise<void> {
    if (!this.configLoadedAt) await this.loadConfig();

    const cursor = await this.state.storage.get<string>("cursor");
    const url = new URL(JETSTREAM_URL);
    url.searchParams.append("wantedCollections", "app.bsky.feed.post");
    url.searchParams.append("wantedCollections", "app.bsky.graph.follow");
    if (cursor) url.searchParams.set("cursor", cursor);

    console.log(
      `[jetstream-do] Opening WebSocket (cursor=${cursor ? "stored" : "fresh"})`,
    );

    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.addEventListener("message", (evt) => {
      this.handleMessage(evt.data as string);
    });

    ws.addEventListener("close", () => {
      console.log(
        "[jetstream-do] WebSocket closed — will reconnect on next cron ping",
      );
      this.ws = null;
    });

    ws.addEventListener("error", () => {
      console.error("[jetstream-do] WebSocket error");
      this.ws = null;
    });

    // Schedule the first flush
    await this.state.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
  }

  private handleMessage(data: string): void {
    try {
      const event = JSON.parse(data) as {
        kind: string;
        did: string;
        time_us: number;
        commit?: {
          operation: string;
          collection: string;
          rkey: string;
          cid: string;
          record?: {
            $type?: string;
            text?: string;
            createdAt?: string;
            subject?: string;
          };
        };
      };

      if (event.kind !== "commit" || !event.commit) return;
      const { commit, did, time_us } = event;

      if (time_us) this.lastEventTimeUs = time_us;

      // ── Post events: match against keyword index ───────────────────────────
      if (
        commit.operation === "create" &&
        commit.collection === "app.bsky.feed.post" &&
        commit.record?.$type === "app.bsky.feed.post" &&
        this.keywordIndex.size > 0
      ) {
        const text = commit.record?.text;
        if (!text) return;

        const textLower = text.toLowerCase();
        const matchingTags = new Set<string>();

        for (const [keyword, tags] of this.keywordIndex) {
          if (
            textLower.includes(keyword) ||
            textLower.includes(`#${keyword}`)
          ) {
            for (const tag of tags) matchingTags.add(tag);
          }
        }

        if (matchingTags.size > 0) {
          const uri = `at://${did}/app.bsky.feed.post/${commit.rkey}`;
          this.buffer.push({
            kind: "post",
            uri,
            cid: commit.cid,
            author: did,
            text,
            createdAt:
              commit.record.createdAt ??
              new Date(Math.round(time_us / 1_000)).toISOString(),
            algoTags: matchingTags,
          });
        }
      }

      // ── Follow events: detect new followers for follow-back ────────────────
      if (
        commit.operation === "create" &&
        commit.collection === "app.bsky.graph.follow" &&
        commit.record?.$type === "app.bsky.graph.follow" &&
        this.publisherDid &&
        commit.record?.subject === this.publisherDid &&
        did !== this.publisherDid
      ) {
        this.buffer.push({ kind: "follow", did });
      }
    } catch {
      /* malformed JSON — skip */
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0 && this.lastEventTimeUs === null) return;

    const items = [...this.buffer];
    this.buffer = [];

    const now = new Date().toISOString();
    const posts = items.filter((i): i is BufferedPost => i.kind === "post");
    const follows = items.filter(
      (i): i is BufferedFollow => i.kind === "follow",
    );

    // ── Flush matched posts to D1 ──────────────────────────────────────────
    let indexed = 0;
    for (const post of posts) {
      try {
        const existing = await this.env.DB.prepare(
          "SELECT algo_tags FROM indexed_posts WHERE uri = ?",
        )
          .bind(post.uri)
          .first<{ algo_tags: string | null }>();

        const mergedTags = mergeAlgoTags(
          existing?.algo_tags ?? null,
          post.algoTags,
        );

        await this.env.DB.prepare(
          `INSERT INTO indexed_posts (uri, cid, author, text, algo_tags, indexed_at, likes, reposts, replies, quotes)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0)
           ON CONFLICT(uri) DO UPDATE SET algo_tags = ?, engagement_synced_at = ?`,
        )
          .bind(
            post.uri,
            post.cid,
            post.author,
            post.text,
            mergedTags,
            now,
            mergedTags,
            now,
          )
          .run();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await markAuthorDirty(this.env as any, post.author);
        indexed++;
      } catch (err) {
        console.error("[jetstream-do] Insert failed:", post.uri.slice(-20), err);
      }
    }

    // ── Queue new followers for follow-back ───────────────────────────────
    if (follows.length > 0 && this.publisherDid) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await ensureFollowQueueTable(this.env as any);
        const dids = follows.map((f) => f.did);
        const placeholders = dids.map(() => "?").join(",");

        const existing = await this.env.DB.prepare(
          `SELECT did FROM auto_follow_queue WHERE did IN (${placeholders})
           UNION
           SELECT did FROM auto_follow_log WHERE did IN (${placeholders})`,
        )
          .bind(...dids, ...dids)
          .all<{ did: string }>();

        const alreadyTracked = new Set(existing.results.map((r) => r.did));
        const toQueue = dids.filter((d) => !alreadyTracked.has(d));

        if (toQueue.length > 0) {
          const stmts = toQueue.map((did) =>
            this.env.DB.prepare(
              `INSERT INTO auto_follow_queue (did, handle, followers_count, market)
               VALUES (?, '', 0, 'jetstream') ON CONFLICT(did) DO NOTHING`,
            ).bind(did),
          );
          await this.env.DB.batch(stmts);
          console.log(`[jetstream-do] Queued ${toQueue.length} new followers`);
        }
      } catch (err) {
        console.error("[jetstream-do] Follow queue error:", err);
      }
    }

    // ── Persist cursor to DO storage + D1 (for dashboard) ────────────────
    if (this.lastEventTimeUs !== null) {
      await this.state.storage.put("cursor", String(this.lastEventTimeUs));

      const statsStmts = [
        this.env.DB.prepare(
          "INSERT INTO cron_settings (key, value) VALUES ('jetstream_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        ).bind(String(this.lastEventTimeUs)),
        this.env.DB.prepare(
          "INSERT INTO cron_settings (key, value) VALUES ('jetstream_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        ).bind(new Date().toISOString()),
        this.env.DB.prepare(
          "INSERT INTO cron_settings (key, value) VALUES ('jetstream_last_indexed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        ).bind(String(indexed)),
      ];
      await this.env.DB.batch(statsStmts).catch(() => {});
    }

    if (indexed > 0 || follows.length > 0) {
      console.log(
        `[jetstream-do] Flush — ${indexed} posts, ${follows.length} follows queued`,
      );
    }
  }
}
