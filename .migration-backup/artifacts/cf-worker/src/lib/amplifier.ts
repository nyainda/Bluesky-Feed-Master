import type { Env } from "../index";

export async function scheduleAmplification(
  env: Env,
  postUri: string,
  postCid: string,
  postText: string,
  amplifyAt: string,
): Promise<number> {
  const result = await env.DB.prepare(
    "INSERT INTO amplification_queue (post_uri, post_cid, post_text, amplify_at, status) VALUES (?, ?, ?, ?, 'pending')",
  )
    .bind(postUri, postCid, postText, amplifyAt)
    .run();
  return Number(result.meta.last_row_id);
}

export async function deleteAmplification(env: Env, id: number): Promise<void> {
  await env.DB.prepare("DELETE FROM amplification_queue WHERE id = ? AND status = 'pending'").bind(id).run();
}

export async function runAmplifier(env: Env): Promise<void> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) return;

  const nowIso = new Date().toISOString();
  const rows = await env.DB.prepare(
    "SELECT id, post_uri, post_cid, post_text FROM amplification_queue WHERE status = 'pending' AND amplify_at <= ? LIMIT 5",
  )
    .bind(nowIso)
    .all<{ id: number; post_uri: string; post_cid: string; post_text: string }>();

  const due = rows.results ?? [];
  if (due.length === 0) return;

  console.log(`[amplifier] ${due.length} posts due for amplification`);

  const { AtpAgent } = await import("@atproto/api");
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });

  for (const row of due) {
    try {
      await agent.repost(row.post_uri, row.post_cid);
      await env.DB.prepare(
        "UPDATE amplification_queue SET status = 'done', done_at = ? WHERE id = ?",
      )
        .bind(nowIso, row.id)
        .run();
      console.log(`[amplifier] Reposted ${row.post_uri}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[amplifier] Failed to repost ${row.post_uri}:`, error);
      await env.DB.prepare(
        "UPDATE amplification_queue SET status = 'failed', error = ?, done_at = ? WHERE id = ?",
      )
        .bind(error, nowIso, row.id)
        .run();
    }
  }
}
