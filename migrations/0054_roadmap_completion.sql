-- Roadmap completion support tables.
-- External-service setup remains operator-owned; these tables provide the app
-- state needed for branding, rate limits, public profiles, and community pages.

CREATE TABLE IF NOT EXISTS guild_branding (
    guild_id TEXT PRIMARY KEY,
    display_name TEXT,
    accent_color TEXT,
    logo_url TEXT,
    banner_url TEXT,
    public_tagline TEXT,
    custom_css_json TEXT DEFAULT '{}',
    updated_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_rate_limits (
    key TEXT PRIMARY KEY,
    route_group TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expires_at
    ON api_rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS user_profile_preferences (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    display_name TEXT,
    bio TEXT,
    badge_flags TEXT DEFAULT '[]',
    show_voice_stats INTEGER NOT NULL DEFAULT 0,
    show_command_stats INTEGER NOT NULL DEFAULT 1,
    public_profile INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_user_profile_preferences_guild
    ON user_profile_preferences(guild_id);

CREATE TABLE IF NOT EXISTS community_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    source TEXT NOT NULL DEFAULT 'external',
    rating INTEGER,
    review_url TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

