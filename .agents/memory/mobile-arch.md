---
name: FeedForge Mobile architecture
description: Durable decisions for the bluesky-feeds-mobile Expo companion app.
---

# FeedForge Mobile — Key Decisions

## API Connection (Mode A)
- Uses `@workspace/api-client-react` generated hooks everywhere. No custom fetch wrappers.
- `setBaseUrl` must be called at module level (outside any component) in `_layout.tsx`, not inside `useEffect`. Expo bundles run outside the web proxy and need an absolute URL.
- No auth needed — the web app has no authentication layer.

**Why:** `EXPO_PUBLIC_DOMAIN` is injected as `$REPLIT_DEV_DOMAIN` by the dev script; calling `setBaseUrl` inside a component risks it running after the first query fires.

## Bundle Identifiers
- iOS: `com.replit.blueskyfeedsmobile`
- Android package: `com.replit.blueskyfeedsmobile`

**Why:** Required for Expo Launch (App Store submission). Never change bundle identifiers after initial setup.

## Colors
- Light/dark tokens derived from sibling web app's `index.css` HSL values (not invented).
- Primary light `#0085ff` (hsl 210 100% 52%), dark `#3d9dff` (hsl 210 100% 62%).
- radius: 10px (from web's `--radius: 0.625rem`).
