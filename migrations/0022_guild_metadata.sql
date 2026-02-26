-- Guild metadata table
-- Stores comprehensive guild profile data fetched via bot token.
-- Refreshed by the daily cron job so the dashboard has up-to-date server info
-- including icon, banner, description, features, verification level, etc.

CREATE TABLE IF NOT EXISTS guild_metadata (
    guild_id TEXT PRIMARY KEY,

    -- Basic identity
    name TEXT NOT NULL,
    icon TEXT DEFAULT NULL,            -- Icon hash (use CDN: icons/{id}/{hash}.png)
    banner TEXT DEFAULT NULL,          -- Banner image hash
    splash TEXT DEFAULT NULL,          -- Invite splash image hash
    discovery_splash TEXT DEFAULT NULL, -- Discovery splash image hash
    description TEXT DEFAULT NULL,     -- Server description

    -- Owner
    owner_id TEXT DEFAULT NULL,

    -- Vanity & branding
    vanity_url_code TEXT DEFAULT NULL, -- Custom invite code (e.g. "discord-developers")
    preferred_locale TEXT DEFAULT NULL, -- e.g. "en-US"

    -- Verification & moderation
    verification_level INTEGER DEFAULT 0,   -- 0=None, 1=Low, 2=Medium, 3=High, 4=Very High
    explicit_content_filter INTEGER DEFAULT 0, -- 0=Disabled, 1=MembersWithoutRoles, 2=AllMembers
    nsfw_level INTEGER DEFAULT 0,           -- 0=Default, 1=Explicit, 2=Safe, 3=AgeRestricted
    mfa_level INTEGER DEFAULT 0,            -- 0=None, 1=Elevated

    -- Notifications
    default_message_notifications INTEGER DEFAULT 0, -- 0=AllMessages, 1=OnlyMentions

    -- Boost info
    premium_tier INTEGER DEFAULT 0,                -- Boost level: 0-3
    premium_subscription_count INTEGER DEFAULT 0,  -- Number of boosts

    -- Counts (snapshot from last refresh)
    approximate_member_count INTEGER DEFAULT NULL,
    approximate_presence_count INTEGER DEFAULT NULL, -- Online count
    max_members INTEGER DEFAULT NULL,
    max_presences INTEGER DEFAULT NULL,

    -- Features (JSON array of feature strings like "COMMUNITY", "BANNER", etc.)
    features TEXT DEFAULT '[]',

    -- System channel
    system_channel_id TEXT DEFAULT NULL,
    system_channel_flags INTEGER DEFAULT 0,
    rules_channel_id TEXT DEFAULT NULL,
    public_updates_channel_id TEXT DEFAULT NULL,
    safety_alerts_channel_id TEXT DEFAULT NULL,

    -- Widget
    widget_enabled INTEGER DEFAULT 0,
    widget_channel_id TEXT DEFAULT NULL,

    -- Timestamps
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- When we last fetched from Discord
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_guild_metadata_fetched ON guild_metadata(fetched_at);
