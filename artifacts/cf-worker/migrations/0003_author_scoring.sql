CREATE TABLE IF NOT EXISTS authors (
  did TEXT PRIMARY KEY,
  needs_recalc INTEGER NOT NULL DEFAULT 0,
  recalc_attempts INTEGER NOT NULL DEFAULT 0,
  next_recalc_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_scored_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS author_scores (
  did TEXT PRIMARY KEY REFERENCES authors(did) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  total_likes INTEGER NOT NULL DEFAULT 0,
  total_reposts INTEGER NOT NULL DEFAULT 0,
  total_replies INTEGER NOT NULL DEFAULT 0,
  formula_version TEXT NOT NULL DEFAULT 'v1',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_authors_needs_recalc_next ON authors(needs_recalc, next_recalc_at);
