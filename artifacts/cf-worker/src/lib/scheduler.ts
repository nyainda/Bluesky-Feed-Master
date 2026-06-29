import { eq, lte, and } from "drizzle-orm";
import { createDb, scheduledPostsTable } from "../db";
import type { Env } from "../index";

/**
 * Scheduled post dispatcher — runs every 3 minutes via the same Cron Trigger as the indexer.
 * Finds all pending posts whose scheduled_at has passed and posts them to Bluesky.
 * Threads are posted sequentially with a 500 ms pause between parts.
 */
export async function runScheduler(env: Env): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) {
    console.log("[scheduler] BLUESKY credentials not set — skipping.");
    return;
  }

  const db = createDb(env.DB);
  const now = new Date().toISOString();

  // ── Auto-retry: reset failed posts back to pending (max 3 retries, 5-min delay) ──
  const RETRY_MAX = 3;
  const RETRY_DELAY_MS = 5 * 60_000;
  const failedPosts = await db.select().from(scheduledPostsTable).where(eq(scheduledPostsTable.status, "failed"));
  for (const post of failedPosts) {
    const retryCount = (post.errorMessage?.match(/\[retry:\d+\]/g) ?? []).length;
    if (retryCount < RETRY_MAX) {
      const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
      console.log(`[scheduler] Post ${post.id} failed ${retryCount}x — scheduling retry ${retryCount + 1}/${RETRY_MAX} at ${retryAt}`);
      await db.update(scheduledPostsTable)
        .set({ status: "pending", scheduledAt: retryAt })
        .where(eq(scheduledPostsTable.id, post.id));
    } else {
      console.log(`[scheduler] Post ${post.id} exhausted retries — staying failed permanently.`);
    }
  }

  const due = await db
    .select()
    .from(scheduledPostsTable)
    .where(and(eq(scheduledPostsTable.status, "pending"), lte(scheduledPostsTable.scheduledAt, now)));

  if (due.length === 0) return;

  console.log(`[scheduler] ${due.length} post(s) due — sending now.`);

  const { AtpAgent, RichText } = await import("@atproto/api");

  for (const post of due) {
    try {
      const agent = new AtpAgent({ service: "https://bsky.social" });
      await agent.login({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });

      async function postPart(
        text: string,
        replyRef?: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } },
      ): Promise<{ uri: string; cid: string }> {
        const rt = new RichText({ text });
        await rt.detectFacets(agent);
        return agent.post({ text: rt.text, facets: rt.facets, reply: replyRef });
      }

      const uris: string[] = [];

      if (post.isThread && post.threadParts) {
        const parts = JSON.parse(post.threadParts) as string[];
        const allParts = [post.text, ...parts].filter((t) => t?.trim());
        let rootRef: { uri: string; cid: string } | null = null;
        let parentRef: { uri: string; cid: string } | null = null;

        for (const part of allParts) {
          const replyRef =
            rootRef && parentRef ? { root: rootRef, parent: parentRef } : undefined;
          const result = await postPart(part.trim(), replyRef);
          if (!rootRef) rootRef = { uri: result.uri, cid: result.cid };
          parentRef = { uri: result.uri, cid: result.cid };
          uris.push(result.uri);
          if (uris.length < allParts.length) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      } else {
        const result = await postPart(post.text.trim());
        uris.push(result.uri);
      }

      await db
        .update(scheduledPostsTable)
        .set({ status: "sent", sentAt: new Date().toISOString() })
        .where(eq(scheduledPostsTable.id, post.id));

      console.log(`[scheduler] Post ${post.id} sent — URIs: ${uris.join(", ")}`);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      // Prefix with [retry:N] so the retry counter can track attempts
      const retryCount = (post.errorMessage?.match(/\[retry:\d+\]/g) ?? []).length;
      const taggedMessage = `[retry:${retryCount + 1}] ${errMessage}`;
      await db
        .update(scheduledPostsTable)
        .set({ status: "failed", errorMessage: taggedMessage })
        .where(eq(scheduledPostsTable.id, post.id));
      console.error(`[scheduler] Post ${post.id} failed:`, err);
    }
  }

  console.log(`[scheduler] Done — processed ${due.length} post(s).`);
}
