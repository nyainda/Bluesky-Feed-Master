import type { Env } from "../index";

export type PlatformConfig = {
  // Mastodon
  instanceUrl?: string;
  accessToken?: string;
  // Twitter/X (OAuth 1.0a)
  apiKey?: string;
  apiKeySecret?: string;
  twitterAccessToken?: string;
  twitterAccessTokenSecret?: string;
  // Threads
  threadsAccessToken?: string;
  threadsUserId?: string;
};

export type SyndicationPlatform = {
  id: number;
  platform: string;
  label: string;
  config: PlatformConfig;
  enabled: boolean;
  createdAt: string;
};

// ─── OAuth 1.0a for Twitter ──────────────────────────────────────────────────

async function hmacSha1Base64(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function buildOAuthHeader(
  method: string,
  url: string,
  apiKey: string,
  apiKeySecret: string,
  accessToken: string,
  accessTokenSecret: string,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const sortedParams = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join("&");

  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(sortedParams)].join("&");
  const signingKey = `${percentEncode(apiKeySecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);

  const headerParts = {
    ...oauthParams,
    oauth_signature: signature,
  };

  const headerStr = Object.entries(headerParts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth ${headerStr}`;
}

// ─── Platform Posters ────────────────────────────────────────────────────────

export async function postToMastodon(
  instanceUrl: string,
  accessToken: string,
  text: string,
): Promise<string> {
  const cleanUrl = instanceUrl.replace(/\/$/, "");
  const resp = await fetch(`${cleanUrl}/api/v1/statuses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: text.slice(0, 500) }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Mastodon ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { id: string; url: string };
  return data.id;
}

export async function postToTwitter(config: Required<Pick<PlatformConfig, "apiKey" | "apiKeySecret" | "twitterAccessToken" | "twitterAccessTokenSecret">>, text: string): Promise<string> {
  const url = "https://api.twitter.com/2/tweets";
  const oauthHeader = await buildOAuthHeader(
    "POST",
    url,
    config.apiKey,
    config.apiKeySecret,
    config.twitterAccessToken,
    config.twitterAccessTokenSecret,
  );
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: oauthHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: text.slice(0, 280) }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twitter ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { data: { id: string } };
  return data.data.id;
}

export async function postToThreads(
  accessToken: string,
  userId: string,
  text: string,
): Promise<string> {
  // Step 1: Create media container
  const createResp = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads?media_type=TEXT&text=${encodeURIComponent(text.slice(0, 500))}&access_token=${accessToken}`,
    { method: "POST" },
  );
  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Threads create ${createResp.status}: ${err.slice(0, 200)}`);
  }
  const { id: containerId } = (await createResp.json()) as { id: string };

  // Brief pause for container processing
  await new Promise((r) => setTimeout(r, 1500));

  // Step 2: Publish
  const publishResp = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads_publish?creation_id=${containerId}&access_token=${accessToken}`,
    { method: "POST" },
  );
  if (!publishResp.ok) {
    const err = await publishResp.text();
    throw new Error(`Threads publish ${publishResp.status}: ${err.slice(0, 200)}`);
  }
  const { id } = (await publishResp.json()) as { id: string };
  return id;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

export async function getEnabledPlatforms(env: Env): Promise<SyndicationPlatform[]> {
  const rows = await env.DB.prepare(
    "SELECT id, platform, label, config_json, enabled, created_at FROM syndication_platforms WHERE enabled = 1 ORDER BY id",
  ).all<{ id: number; platform: string; label: string; config_json: string; enabled: number; created_at: string }>();

  return (rows.results ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    label: r.label,
    config: JSON.parse(r.config_json) as PlatformConfig,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  }));
}

async function logSyndication(env: Env, postUri: string, platformId: number, platform: string, status: string, externalId?: string, error?: string) {
  await env.DB.prepare(
    "INSERT INTO syndication_log (post_uri, platform_id, platform, status, external_id, error) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(postUri, platformId, platform, status, externalId ?? null, error ?? null)
    .run();
}

// ─── Main syndication runner ─────────────────────────────────────────────────

export async function syndicatePost(env: Env, postUri: string, text: string): Promise<void> {
  const platforms = await getEnabledPlatforms(env);
  if (platforms.length === 0) return;

  for (const platform of platforms) {
    try {
      let externalId: string | undefined;

      if (platform.platform === "mastodon") {
        const { instanceUrl, accessToken } = platform.config;
        if (!instanceUrl || !accessToken) continue;
        externalId = await postToMastodon(instanceUrl, accessToken, text);
      } else if (platform.platform === "twitter") {
        const { apiKey, apiKeySecret, twitterAccessToken, twitterAccessTokenSecret } = platform.config;
        if (!apiKey || !apiKeySecret || !twitterAccessToken || !twitterAccessTokenSecret) continue;
        externalId = await postToTwitter({ apiKey, apiKeySecret, twitterAccessToken, twitterAccessTokenSecret }, text);
      } else if (platform.platform === "threads") {
        const { threadsAccessToken, threadsUserId } = platform.config;
        if (!threadsAccessToken || !threadsUserId) continue;
        externalId = await postToThreads(threadsAccessToken, threadsUserId, text);
      }

      await logSyndication(env, postUri, platform.id, platform.platform, "success", externalId);
      console.log(`[syndication] Posted to ${platform.label} — external id: ${externalId}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[syndication] Failed for ${platform.label}:`, error);
      await logSyndication(env, postUri, platform.id, platform.platform, "failed", undefined, error);
    }
  }
}
