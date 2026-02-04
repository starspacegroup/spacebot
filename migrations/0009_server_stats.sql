-- Server statistics table for tracking historical metrics
-- This stores periodic snapshots of server stats for graphing over time

CREATE TABLE IF NOT EXISTS server_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    
    -- Member counts
    member_count INTEGER NOT NULL DEFAULT 0,
    online_count INTEGER DEFAULT NULL, -- May not always be available
    bot_count INTEGER DEFAULT NULL,
    
    -- Additional metrics (for future use)
    channel_count INTEGER DEFAULT NULL,
    role_count INTEGER DEFAULT NULL,
    emoji_count INTEGER DEFAULT NULL,
    boost_count INTEGER DEFAULT NULL,
    boost_level INTEGER DEFAULT NULL,
    
    -- Timestamp for graphing
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_server_stats_guild_id ON server_stats(guild_id);
CREATE INDEX IF NOT EXISTS idx_server_stats_recorded_at ON server_stats(recorded_at);
CREATE INDEX IF NOT EXISTS idx_server_stats_guild_recorded ON server_stats(guild_id, recorded_at);

-- Keep only recent stats per guild to avoid bloat (optional cleanup index)
CREATE INDEX IF NOT EXISTS idx_server_stats_cleanup ON server_stats(guild_id, recorded_at DESC);
