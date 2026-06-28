-- Migration 0007: Auto-unfollow history log
CREATE TABLE IF NOT EXISTS auto_unfollow_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  did           TEXT NOT NULL,
  handle        TEXT NOT NULL DEFAULT '',
  unfollowed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auto_unfollow_log_unfollowed_at
  ON auto_unfollow_log (unfollowed_at DESC);
