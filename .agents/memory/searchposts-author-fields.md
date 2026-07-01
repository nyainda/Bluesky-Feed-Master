---
name: Bluesky searchPosts author fields
description: searchPosts API does not return followersCount/postsCount on author objects — all quality filtering must happen at follow-time via getProfile().
---

**Rule:** Never filter on `author.followersCount` or `author.postsCount` in `app.bsky.feed.searchPosts` results — both fields are `undefined` regardless of the account. They coerce to `0`, causing every candidate to fail quality filters.

**Why:** The Bluesky `searchPosts` endpoint returns minimal author data (did, handle, displayName, avatar). Count fields are omitted. This caused auto-follow discovery to find 99–100 candidates per keyword and discard all of them via `followers < 100` and `posts < 5` checks, resulting in 0 follows being queued.

**How to apply:**
- In discovery (`auto-follow.ts`): skip all count filters. Store `followersCount: -1` as a sentinel in the queue.
- At follow-time (`scheduled-follow.ts`): when `followers_count === -1`, call `agent.getProfile({ actor: did })` to get real `followersCount` and `postsCount`, then apply `minFollowers`, `maxFollowers`, `minPosts` filters before deciding to follow or skip.
- `getFollows()` and `getProfile()` DO return reliable counts — only `searchPosts` author objects are missing them.
