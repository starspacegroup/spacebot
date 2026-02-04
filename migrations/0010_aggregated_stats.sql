-- Aggregated statistics table for pre-computed metrics
-- This stores hourly/daily aggregates to avoid reprocessing raw events

CREATE TABLE IF NOT EXISTS aggregated_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    
    -- Time period this aggregate covers
    period_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
    period_start DATETIME NOT NULL, -- Start of the period (e.g., 2026-02-04 13:00:00 for hourly)
    period_end DATETIME NOT NULL, -- End of the period (e.g., 2026-02-04 14:00:00 for hourly)
    
    -- Member growth metrics (from MEMBER_JOIN/MEMBER_LEAVE events)
    member_joins INTEGER DEFAULT 0,
    member_leaves INTEGER DEFAULT 0,
    member_net_change INTEGER DEFAULT 0, -- joins - leaves
    
    -- Voice activity metrics (in seconds)
    voice_total_seconds INTEGER DEFAULT 0, -- Total voice time across all users
    voice_unique_users INTEGER DEFAULT 0, -- Number of unique users in voice
    voice_peak_concurrent INTEGER DEFAULT 0, -- Peak concurrent voice users
    
    -- Message activity
    message_count INTEGER DEFAULT 0,
    message_unique_users INTEGER DEFAULT 0,
    
    -- General activity
    total_events INTEGER DEFAULT 0,
    
    -- Processing metadata
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_event_id INTEGER DEFAULT NULL, -- Last event ID processed for this period
    
    UNIQUE(guild_id, period_type, period_start)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_aggregated_stats_guild_id ON aggregated_stats(guild_id);
CREATE INDEX IF NOT EXISTS idx_aggregated_stats_period ON aggregated_stats(period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_aggregated_stats_guild_period ON aggregated_stats(guild_id, period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_aggregated_stats_lookup ON aggregated_stats(guild_id, period_type, period_start DESC);

-- Voice session tracking for accurate time calculations
-- Tracks ongoing and completed voice sessions
CREATE TABLE IF NOT EXISTS voice_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    
    -- Session timing
    joined_at DATETIME NOT NULL,
    left_at DATETIME DEFAULT NULL, -- NULL means still in channel
    duration_seconds INTEGER DEFAULT NULL, -- Computed on leave
    
    -- Associated event IDs for traceability
    join_event_id INTEGER,
    leave_event_id INTEGER,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for voice sessions
CREATE INDEX IF NOT EXISTS idx_voice_sessions_guild ON voice_sessions(guild_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_active ON voice_sessions(guild_id, left_at) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_time ON voice_sessions(guild_id, joined_at, left_at);

-- Stats processing checkpoint - tracks what's been processed
CREATE TABLE IF NOT EXISTS stats_processing_checkpoint (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    checkpoint_type TEXT NOT NULL, -- 'hourly', 'daily', 'voice_sessions'
    last_processed_event_id INTEGER DEFAULT 0,
    last_processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(guild_id, checkpoint_type)
);

CREATE INDEX IF NOT EXISTS idx_stats_checkpoint_guild ON stats_processing_checkpoint(guild_id);
