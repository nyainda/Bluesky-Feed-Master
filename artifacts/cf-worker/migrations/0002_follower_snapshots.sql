-- FeedForge D1 Migration 0002: follower_snapshots + scheduled_posts
-- Remote: wrangler d1 migrations apply feedforge-db --remote

CREATE TABLE IF NOT EXISTS follower_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  followers_count INTEGER NOT NULL,
  follows_count   INTEGER NOT NULL,
  posts_count     INTEGER NOT NULL,
  recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  text          TEXT NOT NULL,
  thread_parts  TEXT,
  is_thread     INTEGER NOT NULL DEFAULT 0,
  scheduled_at  TEXT NOT NULL,
  sent_at       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
