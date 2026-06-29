import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const feedsTable = sqliteTable("feeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordName: text("record_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const keywordsTable = sqliteTable("keywords", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feedId: integer("feed_id")
    .notNull()
    .references(() => feedsTable.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const indexedPostsTable = sqliteTable("indexed_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uri: text("uri").notNull().unique(),
  cid: text("cid").notNull(),
  author: text("author").notNull(),
  text: text("text").notNull(),
  algoTags: text("algo_tags").notNull().default(""),
  indexedAt: text("indexed_at").notNull().default(sql`(datetime('now'))`),
  likes: integer("likes").notNull().default(0),
  reposts: integer("reposts").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  quotes: integer("quotes").notNull().default(0),
  engagementSyncedAt: text("engagement_synced_at"),
});

export const followerSnapshotsTable = sqliteTable("follower_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  followersCount: integer("followers_count").notNull(),
  followsCount: integer("follows_count").notNull(),
  postsCount: integer("posts_count").notNull(),
  recordedAt: text("recorded_at").notNull().default(sql`(datetime('now'))`),
});

export const scheduledPostsTable = sqliteTable("scheduled_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  threadParts: text("thread_parts"),
  isThread: integer("is_thread", { mode: "boolean" }).notNull().default(false),
  scheduledAt: text("scheduled_at").notNull(),
  sentAt: text("sent_at"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const authorsTable = sqliteTable("authors", {
  did: text("did").primaryKey(),
  needsRecalc: integer("needs_recalc", { mode: "boolean" }).notNull().default(false),
  recalcAttempts: integer("recalc_attempts").notNull().default(0),
  nextRecalcAt: text("next_recalc_at").notNull().default(sql`(datetime('now'))`),
  lastScoredAt: text("last_scored_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const authorScoresTable = sqliteTable("author_scores", {
  did: text("did").primaryKey().references(() => authorsTable.did, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0),
  postCount: integer("post_count").notNull().default(0),
  totalLikes: integer("total_likes").notNull().default(0),
  totalReposts: integer("total_reposts").notNull().default(0),
  totalReplies: integer("total_replies").notNull().default(0),
  formulaVersion: text("formula_version").notNull().default("v1"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const feedRankedPostsTable = sqliteTable(
  "feed_ranked_posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedId: integer("feed_id").notNull().references(() => feedsTable.id, { onDelete: "cascade" }),
    postUri: text("post_uri").notNull().references(() => indexedPostsTable.uri, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    finalScore: real("final_score").notNull().default(0),
    qualityScore: real("quality_score").notNull().default(0),
    computedAt: text("computed_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    feedPostUnique: uniqueIndex("feed_ranked_posts_feed_post_unique").on(table.feedId, table.postUri),
    feedRankIdx: index("idx_feed_ranked_posts_feed_rank").on(table.feedId, table.rank),
    postUriIdx: index("idx_feed_ranked_posts_post_uri").on(table.postUri),
  }),
);

export const syndicationPlatformsTable = sqliteTable("syndication_platforms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platform: text("platform").notNull(),
  label: text("label").notNull(),
  configJson: text("config_json").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const syndicationLogTable = sqliteTable("syndication_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postUri: text("post_uri").notNull(),
  platformId: integer("platform_id").notNull().default(0),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("pending"),
  externalId: text("external_id"),
  error: text("error"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const amplificationQueueTable = sqliteTable("amplification_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postUri: text("post_uri").notNull(),
  postCid: text("post_cid").notNull(),
  postText: text("post_text").notNull().default(""),
  amplifyAt: text("amplify_at").notNull(),
  status: text("status").notNull().default("pending"),
  doneAt: text("done_at"),
  error: text("error"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const cronSettingsTable = sqliteTable("cron_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const autoUnfollowLogTable = sqliteTable(
  "auto_unfollow_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    did: text("did").notNull(),
    handle: text("handle").notNull().default(""),
    unfollowedAt: text("unfollowed_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    unfollowedAtIdx: index("idx_auto_unfollow_log_unfollowed_at").on(table.unfollowedAt),
  }),
);

export type Feed = typeof feedsTable.$inferSelect;
export type Keyword = typeof keywordsTable.$inferSelect;
export type IndexedPost = typeof indexedPostsTable.$inferSelect;
export type FollowerSnapshot = typeof followerSnapshotsTable.$inferSelect;
export type Author = typeof authorsTable.$inferSelect;
export type AuthorScore = typeof authorScoresTable.$inferSelect;
export type FeedRankedPost = typeof feedRankedPostsTable.$inferSelect;
export type CronSetting = typeof cronSettingsTable.$inferSelect;
export type SyndicationPlatform = typeof syndicationPlatformsTable.$inferSelect;
export type SyndicationLog = typeof syndicationLogTable.$inferSelect;
export type AmplificationQueueItem = typeof amplificationQueueTable.$inferSelect;
export type AutoUnfollowLogEntry = typeof autoUnfollowLogTable.$inferSelect;
