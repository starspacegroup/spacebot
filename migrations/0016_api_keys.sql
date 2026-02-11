-- API Keys table for external app authentication
-- Allows admins to create API keys scoped to specific guilds

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  -- The key prefix (first 8 chars) for identification without exposing full key
  key_prefix TEXT NOT NULL,
  -- SHA-256 hash of the full API key (we never store the raw key)
  key_hash TEXT NOT NULL,
  -- Scopes define what the key can access (JSON array)
  -- e.g. ["logs:read", "automations:read", "commands:read", "stats:read", "settings:read"]
  scopes TEXT NOT NULL DEFAULT '[]',
  -- Who created this key
  created_by TEXT NOT NULL,
  -- Optional expiration (NULL = never expires)
  expires_at TEXT DEFAULT NULL,
  -- Track last usage
  last_used_at TEXT DEFAULT NULL,
  -- Soft revoke without deleting
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for fast lookups by guild
CREATE INDEX IF NOT EXISTS idx_api_keys_guild_id ON api_keys(guild_id);

-- Index for fast lookups by key prefix (used during auth)
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);

-- Index for fast lookups by key hash (used during auth)
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
