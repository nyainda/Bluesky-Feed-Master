-- FeedForge D1 Schema (SQLite)
-- Run: wrangler d1 execute feedforge-db --file ./migrations/0001_init.sql
-- Remote: wrangler d1 execute feedforge-db --remote --file ./migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indexed_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uri TEXT NOT NULL UNIQUE,
  cid TEXT NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  algo_tags TEXT NOT NULL DEFAULT '',
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  quotes INTEGER NOT NULL DEFAULT 0,
  engagement_synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_indexed_at ON indexed_posts(indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_algo_tags ON indexed_posts(algo_tags);
CREATE INDEX IF NOT EXISTS idx_keywords_feed_id ON keywords(feed_id);
