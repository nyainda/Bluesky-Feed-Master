import type { Env } from "../index";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function postUriToUrl(uri: string): string {
  // at://did:plc:xxx/app.bsky.feed.post/rkey → https://bsky.app/profile/did:plc:xxx/post/rkey
  const match = uri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  if (match) return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
  return `https://bsky.app`;
}

export async function generateFeedRss(env: Env, feedId: number): Promise<string | null> {
  // Load feed metadata
  const feedRow = await env.DB.prepare("SELECT * FROM feeds WHERE id = ?")
    .bind(feedId)
    .first<{ id: number; record_name: string; display_name: string; description: string | null; is_active: number }>();

  if (!feedRow) return null;

  // Load top ranked posts (ranked preferred, fall back to recent)
  const rankedRows = await env.DB.prepare(
    `SELECT p.uri, p.text, p.author, p.indexed_at, p.likes, p.reposts, p.replies
     FROM feed_ranked_posts r
     JOIN indexed_posts p ON p.uri = r.post_uri
     WHERE r.feed_id = ?
     ORDER BY r.rank ASC
     LIMIT 50`,
  )
    .bind(feedId)
    .all<{ uri: string; text: string; author: string; indexed_at: string; likes: number; reposts: number; replies: number }>();

  let posts = rankedRows.results ?? [];

  if (posts.length === 0) {
    // Fallback to recent
    const recentRows = await env.DB.prepare(
      `SELECT uri, text, author, indexed_at, likes, reposts, replies
       FROM indexed_posts
       WHERE instr(',' || algo_tags || ',', ',' || ? || ',') > 0
       ORDER BY indexed_at DESC
       LIMIT 50`,
    )
      .bind(feedRow.record_name)
      .all<{ uri: string; text: string; author: string; indexed_at: string; likes: number; reposts: number; replies: number }>();
    posts = recentRows.results ?? [];
  }

  const hostname = env.FEEDGEN_HOSTNAME ?? "feedforge.workers.dev";
  const feedUrl = `https://${hostname}/api/feeds/${feedId}/rss`;
  const feedLink = `https://bsky.app`;

  const items = posts
    .map((p) => {
      const title = escapeXml(p.text.split("\n")[0].slice(0, 100) || "Post");
      const description = escapeXml(p.text);
      const link = postUriToUrl(p.uri);
      const pubDate = new Date(p.indexed_at).toUTCString();
      const stats = `❤️ ${p.likes} 🔁 ${p.reposts} 💬 ${p.replies}`;
      return `    <item>
      <title>${title}</title>
      <description>${description}

${escapeXml(stats)}</description>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feedRow.display_name)}</title>
    <description>${escapeXml(feedRow.description ?? `${feedRow.display_name} — FeedForge curated Bluesky feed`)}</description>
    <link>${feedLink}</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>FeedForge</generator>
${items}
  </channel>
</rss>`;
}
