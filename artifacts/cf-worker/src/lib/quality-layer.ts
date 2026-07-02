export type QualityInput = {
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  postAgeMinutes: number;
  text: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function computeQualityScore(input: QualityInput): number {
  const safeAge = Math.max(1, input.postAgeMinutes);
  const totalEngagement = input.likes + input.reposts * 2 + input.replies * 3 + input.quotes * 2;
  const engagementVelocity = totalEngagement / safeAge;

  // Reply depth: high reply/like ratio signals discussion quality
  const replyDepthProxy = input.replies / Math.max(1, input.likes + input.reposts + 1);

  // Text quality signal: reward substantive posts, penalise very short ones
  const textLen = input.text.trim().length;
  const textSignal = textLen >= 80 ? 0.12 : textLen >= 40 ? 0.06 : textLen > 0 ? 0.0 : -0.05;

  // Base score from velocity + reply depth (both tanh-normalised to [0,1])
  const velocityScore = 0.5 * Math.tanh(engagementVelocity / 4);
  const depthScore = 0.35 * Math.tanh(replyDepthProxy);

  // Floor: even zero-engagement posts get a small base (0.05) so they can still appear
  const raw = velocityScore + depthScore + textSignal + 0.05;
  return clamp01(raw);
}

/**
 * Exponential recency decay.
 * Half-life = 4 hours → score 0.5 at 4h, ~0.25 at 8h, ~0.06 at 16h, ~0.004 at 36h.
 * Steeper than the previous 6h half-life to more aggressively demote stale posts.
 */
export function computeRecencyDecay(postAgeMinutes: number): number {
  const halfLifeMinutes = 4 * 60; // 4 hours
  return Math.exp((-Math.log(2) * Math.max(0, postAgeMinutes)) / halfLifeMinutes);
}
