import test from "node:test";
import assert from "node:assert/strict";
import { computeAuthorScore } from "../author-scoring-formula";

test("score increases with engagement", () => {
  const low = computeAuthorScore({ postCount: 10, totalLikes: 2, totalReposts: 1, totalReplies: 0 });
  const high = computeAuthorScore({ postCount: 10, totalLikes: 20, totalReposts: 8, totalReplies: 5 });
  assert.ok(high > low);
});

test("score clamps to max", () => {
  const huge = computeAuthorScore({ postCount: 50_000, totalLikes: 100_000, totalReposts: 80_000, totalReplies: 60_000 });
  assert.equal(huge, 10_000);
});
