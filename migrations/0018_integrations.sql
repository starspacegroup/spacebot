-- Integrations system
-- Stores available integrations and per-guild enable/disable state + config

-- Registry of known integrations (global catalog)
CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  author TEXT,
  version TEXT DEFAULT '1.0.0',
  manifest_url TEXT,
  manifest_json TEXT,
  category TEXT DEFAULT 'general',
  is_official INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Per-guild integration state
CREATE TABLE IF NOT EXISTS guild_integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  integration_id INTEGER NOT NULL,
  enabled INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  enabled_by TEXT,
  enabled_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  UNIQUE(guild_id, integration_id)
);

-- Index for fast guild lookups
CREATE INDEX IF NOT EXISTS idx_guild_integrations_guild ON guild_integrations(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_integrations_enabled ON guild_integrations(guild_id, enabled);
