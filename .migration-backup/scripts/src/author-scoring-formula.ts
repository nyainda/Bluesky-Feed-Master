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
  const consistencyScore = Math.min(35, Math.max(0, Math.log1p(postCount) * 10));
  const spamPenalty = postCount > 1200 ? -12 : 0;

  const base = postCount * 0.2 + likes * 0.5 + reposts + replies * 4 + engagementPerPost;
  return Math.min(10_000, Math.max(0, base + consistencyScore + spamPenalty));
}
