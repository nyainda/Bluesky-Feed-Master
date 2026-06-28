---
name: FeedForge Mobile architecture
description: Key decisions for the bluesky-feeds-mobile Expo app and how it connects to the API.
---

# FeedForge Mobile Architecture

## API Connection (Mode A)
- Uses `@workspace/api-client-react` generated hooks throughout — no manual fetch wrappers.
- `setBaseUrl` is called at module level (outside any component) in `app/_layout.tsx`:
  ```ts
  import { setBaseUrl } from "@workspace/api-client-react";
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) setBaseUrl(`https://${domain}`);
  ```
- No auth — the web app has no authentication, so no `setAuthTokenGetter` is needed.

**Why:** Expo bundles run outside the web proxy, so they need an absolute URL. The `EXPO_PUBLIC_DOMAIN` env var is injected by the dev script (`$REPLIT_DEV_DOMAIN`).

## Screens
- Dashboard (`app/(tabs)/index.tsx`) — stats overview, firehose status, 7-day bar chart, top feeds
- Feeds (`app/(tabs)/feeds.tsx`) — list feeds, create feed modal, navigate to detail
- Posts (`app/(tabs)/posts.tsx`) — searchable post list with debounced search
- Settings (`app/(tabs)/settings.tsx`) — health status, firehose, Bluesky profile

## Feed Detail
- `app/feed/[id].tsx` — 3-tab view: Overview, Posts, Keywords; publish and delete actions

## Colors
- Derived from web app's `artifacts/bluesky-feeds/src/index.css` HSL values.
- Light: primary `#0085ff`, background `#fafafa`, card `#ffffff`
- Dark: primary `#3d9dff`, background `#090910`, card `#0e0e14`
- radius: 10px (from web's 0.625rem)
