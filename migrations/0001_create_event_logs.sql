-- Event logs table for storing all Discord events
CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    target_id TEXT,
    target_name TEXT,
    channel_id TEXT,
    channel_name TEXT,
    details TEXT, -- JSON string for additional event-specific data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_event_logs_guild_id ON event_logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_event_type ON event_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_event_logs_event_category ON event_logs(event_category);
CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_event_logs_actor_id ON event_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_guild_created ON event_logs(guild_id, created_at);

-- Guild settings table for per-guild configuration
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    logging_enabled INTEGER DEFAULT 1,
    log_channel_id TEXT,
    excluded_channels TEXT, -- JSON array of channel IDs to exclude
    excluded_categories TEXT, -- JSON array of event categories to exclude
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Event categories reference:
-- 'member' - Member join, leave, ban, unban, update
-- 'message' - Message create, edit, delete, bulk delete
-- 'voice' - Voice channel join, leave, move, mute, deafen
-- 'channel' - Channel create, delete, update
-- 'role' - Role create, delete, update, member role changes
-- 'guild' - Guild settings changes
-- 'emoji' - Emoji/sticker create, delete, update
-- 'invite' - Invite create, delete
-- 'moderation' - Kicks, bans, timeouts
-- 'interaction' - Slash commands, buttons, modals
