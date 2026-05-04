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
  const engagementVelocity = (input.likes + input.reposts * 2 + input.replies * 3 + input.quotes * 2) / safeAge;
  const replyDepthProxy = input.replies / Math.max(1, input.likes + input.reposts);
  const textSignal = input.text.trim().length >= 40 ? 0.1 : -0.05;

  const raw = 0.5 * Math.tanh(engagementVelocity / 4) + 0.35 * Math.tanh(replyDepthProxy) + textSignal;
  return clamp01((raw + 1) / 2);
}

export function computeRecencyDecay(postAgeMinutes: number): number {
  const halfLifeMinutes = 12 * 60;
  return Math.exp((-Math.log(2) * Math.max(0, postAgeMinutes)) / halfLifeMinutes);
}
