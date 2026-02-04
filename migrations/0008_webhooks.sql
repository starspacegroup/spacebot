-- Create webhooks table for storing server webhook endpoints
-- These can be used in automation and command actions

CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    method TEXT DEFAULT 'POST',
    headers TEXT, -- JSON object of custom headers
    enabled INTEGER DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Create index for efficient guild lookups
CREATE INDEX IF NOT EXISTS idx_webhooks_guild_id ON webhooks(guild_id);

-- Create unique constraint on name per guild
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhooks_guild_name ON webhooks(guild_id, name);
