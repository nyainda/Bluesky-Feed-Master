-- Migration 0006: Syndication platforms, log, and amplification queue
CREATE TABLE IF NOT EXISTS syndication_platforms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  platform    TEXT NOT NULL,
  label       TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS syndication_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_uri    TEXT NOT NULL,
  platform_id INTEGER NOT NULL DEFAULT 0,
  platform    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  external_id TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS amplification_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_uri    TEXT NOT NULL,
  post_cid    TEXT NOT NULL,
  post_text   TEXT NOT NULL DEFAULT '',
  amplify_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  done_at     TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
