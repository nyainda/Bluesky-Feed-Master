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

export function computeAuthorScore(input: {
  postCount: number;
  totalLikes: number;
  totalReposts: number;
  totalReplies: number;
}): number {
  const postCount = Math.max(0, input.postCount);
  const likes = Math.max(0, input.totalLikes);
  const reposts = Math.max(0, input.totalReposts);
  const replies = Math.max(0, input.totalReplies);

  const engagementPerPost = postCount === 0 ? 0 : (likes + reposts * 2 + replies * 3) / postCount;
  const consistencyScore = clamp(Math.log1p(postCount) * WEIGHTS.consistency, 0, 35);
  const spamPenalty = postCount > 1200 ? WEIGHTS.spamPenalty : 0;

  const base =
    postCount * WEIGHTS.posts +
    likes * WEIGHTS.likes +
    reposts * WEIGHTS.reposts +
    replies * WEIGHTS.replies +
    engagementPerPost;

  return clamp(base + consistencyScore + spamPenalty, 0, 10_000);
}
