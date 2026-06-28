import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const scheduledPostsTable = pgTable("scheduled_posts", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  threadParts: text("thread_parts"),
  isThread: boolean("is_thread").notNull().default(false),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScheduledPost = typeof scheduledPostsTable.$inferSelect;

export const followerSnapshotsTable = pgTable("follower_snapshots", {
  id: serial("id").primaryKey(),
  followersCount: integer("followers_count").notNull(),
  followsCount: integer("follows_count").notNull(),
  postsCount: integer("posts_count").notNull().default(0),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FollowerSnapshot = typeof followerSnapshotsTable.$inferSelect;
