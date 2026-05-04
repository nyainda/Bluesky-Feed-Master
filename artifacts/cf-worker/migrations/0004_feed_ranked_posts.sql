CREATE TABLE IF NOT EXISTS feed_ranked_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  post_uri TEXT NOT NULL REFERENCES indexed_posts(uri) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  final_score REAL NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(feed_id, post_uri)
);

CREATE INDEX IF NOT EXISTS idx_feed_ranked_posts_feed_rank ON feed_ranked_posts(feed_id, rank);
