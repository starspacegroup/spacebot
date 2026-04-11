CREATE TABLE IF NOT EXISTS live_voice_states (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT,
    display_name TEXT,
    avatar_url TEXT,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    self_mute INTEGER NOT NULL DEFAULT 0,
    self_deaf INTEGER NOT NULL DEFAULT 0,
    server_mute INTEGER NOT NULL DEFAULT 0,
    server_deaf INTEGER NOT NULL DEFAULT 0,
    streaming INTEGER NOT NULL DEFAULT 0,
    self_video INTEGER NOT NULL DEFAULT 0,
    suppress INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_live_voice_states_guild_channel
    ON live_voice_states(guild_id, channel_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_voice_states_updated_at
    ON live_voice_states(updated_at DESC);