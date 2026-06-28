export const WEIGHTS = {
  likes: 0.5,
  reposts: 1.0,
  replies: 4.0,
  posts: 0.2,
  consistency: 10,
  spamPenalty: -12,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeNum(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export function computeAuthorScore(input: {
  postCount: number;
  totalLikes: number;
  totalReposts: number;
  totalReplies: number;
}): number {
  const postCount = Math.max(0, safeNum(input.postCount));
  const likes = Math.max(0, safeNum(input.totalLikes));
  const reposts = Math.max(0, safeNum(input.totalReposts));
  const replies = Math.max(0, safeNum(input.totalReplies));

  // Engagement per post — NaN-safe when postCount is 0
  const engagementPerPost =
    postCount === 0 ? 0 : safeNum((likes + reposts * 2 + replies * 3) / postCount);

  // Consistency bonus: log-scaled, capped at 35 to prevent domination
  const consistencyScore = clamp(safeNum(Math.log1p(postCount) * WEIGHTS.consistency), 0, 35);

  // Spam penalty for prolific low-quality posters
  const spamPenalty = postCount > 1200 ? WEIGHTS.spamPenalty : 0;

  const base =
    postCount * WEIGHTS.posts +
    likes * WEIGHTS.likes +
    reposts * WEIGHTS.reposts +
    replies * WEIGHTS.replies +
    engagementPerPost;

  return clamp(safeNum(base) + consistencyScore + spamPenalty, 0, 10_000);
}
