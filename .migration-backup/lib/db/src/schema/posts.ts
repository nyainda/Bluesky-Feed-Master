import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const indexedPostsTable = pgTable("indexed_posts", {
  id: serial("id").primaryKey(),
  uri: text("uri").notNull().unique(),
  cid: text("cid").notNull(),
  author: text("author").notNull(),
  text: text("text").notNull(),
  algoTags: text("algo_tags").notNull().default(""),
  indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
  likes: integer("likes").notNull().default(0),
  reposts: integer("reposts").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  quotes: integer("quotes").notNull().default(0),
  engagementSyncedAt: timestamp("engagement_synced_at", { withTimezone: true }),
});

export const insertIndexedPostSchema = createInsertSchema(indexedPostsTable).omit({ id: true });
export type InsertIndexedPost = z.infer<typeof insertIndexedPostSchema>;
export type IndexedPost = typeof indexedPostsTable.$inferSelect;

export const subStateTable = pgTable("sub_state", {
  id: serial("id").primaryKey(),
  service: text("service").notNull().unique(),
  cursor: text("cursor").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
