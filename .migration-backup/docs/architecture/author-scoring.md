# Real-time Ranking Architecture

## End-to-end layers

1. Firehose ingestion
2. Feature extraction
3. Smart quality layer
4. Ranking engine (weighted scoring)
5. Precomputed feed tables
6. Fast API serving
7. Feedback loop (engagement updates scores)

## System flow

Bluesky Firehose -> Ingestion Worker -> indexed_posts -> feature + scoring workers -> author_scores + feed_ranked_posts -> fast `/feeds/:id/posts?mode=ranked`

## Core weighting model

`finalScore = 0.4*authorScore + 0.3*engagementVelocity + 0.2*qualityScore + 0.1*recencyDecay`

## Smart quality layer signals

- reply-depth proxy (`replies/(likes+reposts)`)
- engagement velocity over time
- text quality heuristic
- recency normalization

## Feedback loop

Every engagement sync updates `indexed_posts` counters, marks authors dirty, recomputes author score, then refreshes ranked feed placements.
