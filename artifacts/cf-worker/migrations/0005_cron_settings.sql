-- Migration 0005: cron_settings key/value table
CREATE TABLE IF NOT EXISTS cron_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
