import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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

export type Feed = typeof feedsTable.$inferSelect;
export type Keyword = typeof keywordsTable.$inferSelect;
export type IndexedPost = typeof indexedPostsTable.$inferSelect;
export type FollowerSnapshot = typeof followerSnapshotsTable.$inferSelect;
