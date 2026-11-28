-- Per-server bot identity: the bot can use a custom name and image on one server.
-- Name default is "<server name>Bot", image default is the server's icon (computed when applied).

CREATE TABLE IF NOT EXISTS guild_bot_identity (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    name TEXT,                                   -- NULL = "<server name>Bot"
    avatar_mode TEXT NOT NULL DEFAULT 'server_icon', -- 'server_icon' or 'custom'
    avatar_data TEXT,                            -- data URI, only for 'custom' (at most 256 KB decoded)
    applied_key TEXT,                            -- what Discord last accepted, to skip no-op re-applies
    applied_at TEXT,
    last_error TEXT,
    updated_by TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
