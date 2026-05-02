import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feedsTable = pgTable("feeds", {
  id: serial("id").primaryKey(),
  recordName: text("record_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFeedSchema = createInsertSchema(feedsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeed = z.infer<typeof insertFeedSchema>;
export type Feed = typeof feedsTable.$inferSelect;

export const keywordsTable = pgTable("keywords", {
  id: serial("id").primaryKey(),
  feedId: integer("feed_id").notNull().references(() => feedsTable.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertKeywordSchema = createInsertSchema(keywordsTable).omit({ id: true, createdAt: true });
export type InsertKeyword = z.infer<typeof insertKeywordSchema>;
export type Keyword = typeof keywordsTable.$inferSelect;
