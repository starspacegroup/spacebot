-- Guild members and roles cache tables
-- Used to cache Discord member and role data for fast lookups without API calls
-- Updated periodically by the daily cron job

-- ============================================================================
-- ROLES CACHE TABLE
-- Stores all roles for guilds with comprehensive data
-- ============================================================================

CREATE TABLE IF NOT EXISTS guild_roles_cache (
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    
    -- Basic role info
    name TEXT NOT NULL,
    color INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    
    -- Role permissions and flags
    permissions TEXT DEFAULT '0',  -- String to handle large permission integers
    hoist INTEGER DEFAULT 0,       -- 1 if role is displayed separately
    managed INTEGER DEFAULT 0,     -- 1 if managed by integration (bot role, etc)
    mentionable INTEGER DEFAULT 0, -- 1 if role can be mentioned
    
    -- Role icon (boosted servers only)
    icon TEXT DEFAULT NULL,        -- CDN hash for role icon
    unicode_emoji TEXT DEFAULT NULL, -- Unicode emoji for role icon
    
    -- Role tags (for bot/integration roles)
    bot_id TEXT DEFAULT NULL,           -- If managed by a bot, the bot's user ID
    integration_id TEXT DEFAULT NULL,   -- If managed by an integration
    premium_subscriber INTEGER DEFAULT 0, -- 1 if this is the server boost role
    subscription_listing_id TEXT DEFAULT NULL, -- For purchasable roles
    available_for_purchase INTEGER DEFAULT 0, -- 1 if role is available for purchase
    guild_connections INTEGER DEFAULT 0, -- 1 if role is a linked role
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (guild_id, role_id)
);

-- Indexes for role queries
CREATE INDEX IF NOT EXISTS idx_roles_cache_guild ON guild_roles_cache(guild_id);
CREATE INDEX IF NOT EXISTS idx_roles_cache_name ON guild_roles_cache(guild_id, name);
CREATE INDEX IF NOT EXISTS idx_roles_cache_position ON guild_roles_cache(guild_id, position DESC);
CREATE INDEX IF NOT EXISTS idx_roles_cache_managed ON guild_roles_cache(guild_id, managed);

-- ============================================================================
-- MEMBERS CACHE TABLE
-- Stores all members for guilds with comprehensive user data
-- ============================================================================

CREATE TABLE IF NOT EXISTS guild_members_cache (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    
    -- User info (from the user object)
    username TEXT NOT NULL,
    discriminator TEXT DEFAULT '0',     -- Legacy discriminator (now usually '0')
    global_name TEXT DEFAULT NULL,      -- Display name
    avatar TEXT DEFAULT NULL,           -- User avatar hash
    banner TEXT DEFAULT NULL,           -- User banner hash
    accent_color INTEGER DEFAULT NULL,  -- User banner color
    
    -- Member-specific info
    nickname TEXT DEFAULT NULL,         -- Server-specific nickname
    guild_avatar TEXT DEFAULT NULL,     -- Server-specific avatar
    guild_banner TEXT DEFAULT NULL,     -- Server-specific banner
    
    -- Flags and status
    is_bot INTEGER DEFAULT 0,           -- 1 if user is a bot
    is_system INTEGER DEFAULT 0,        -- 1 if user is official Discord system user
    is_owner INTEGER DEFAULT 0,         -- 1 if user is the guild owner
    
    -- User flags (public flags)
    flags INTEGER DEFAULT 0,            -- User public flags (badges, etc)
    premium_type INTEGER DEFAULT 0,     -- Nitro type (0=none, 1=classic, 2=nitro, 3=basic)
    
    -- Membership info
    joined_at DATETIME DEFAULT NULL,    -- When member joined the server
    premium_since DATETIME DEFAULT NULL, -- When member started boosting
    pending INTEGER DEFAULT 0,          -- 1 if member hasn't passed screening
    communication_disabled_until DATETIME DEFAULT NULL, -- Timeout expiration
    
    -- Roles stored as JSON array of role IDs
    roles TEXT DEFAULT '[]',
    
    -- Voice state (if needed)
    deaf INTEGER DEFAULT 0,
    mute INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (guild_id, user_id)
);

-- Indexes for member queries
CREATE INDEX IF NOT EXISTS idx_members_cache_guild ON guild_members_cache(guild_id);
CREATE INDEX IF NOT EXISTS idx_members_cache_username ON guild_members_cache(guild_id, username);
CREATE INDEX IF NOT EXISTS idx_members_cache_bot ON guild_members_cache(guild_id, is_bot);
CREATE INDEX IF NOT EXISTS idx_members_cache_joined ON guild_members_cache(guild_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_members_cache_pending ON guild_members_cache(guild_id, pending);
CREATE INDEX IF NOT EXISTS idx_members_cache_nickname ON guild_members_cache(guild_id, nickname);
CREATE INDEX IF NOT EXISTS idx_members_cache_owner ON guild_members_cache(guild_id, is_owner);

-- ============================================================================
-- CACHE METADATA TABLE
-- Tracks when caches were last refreshed and their status
-- ============================================================================

CREATE TABLE IF NOT EXISTS guild_cache_metadata (
    guild_id TEXT PRIMARY KEY,
    
    -- Counts
    members_count INTEGER DEFAULT 0,
    roles_count INTEGER DEFAULT 0,
    bots_count INTEGER DEFAULT 0,
    humans_count INTEGER DEFAULT 0,
    
    -- Last refresh timestamps
    members_last_refreshed DATETIME DEFAULT NULL,
    roles_last_refreshed DATETIME DEFAULT NULL,
    
    -- Refresh status tracking
    last_refresh_duration_ms INTEGER DEFAULT NULL,
    last_refresh_status TEXT DEFAULT NULL,  -- 'success', 'partial', 'failed'
    last_refresh_error TEXT DEFAULT NULL,
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- USEFUL VIEWS (optional)
-- ============================================================================

-- View for easy member lookups with display name resolution
CREATE VIEW IF NOT EXISTS v_guild_members AS
SELECT 
    guild_id,
    user_id,
    username,
    global_name,
    nickname,
    COALESCE(nickname, global_name, username) as display_name,
    avatar,
    guild_avatar,
    is_bot,
    is_owner,
    joined_at,
    premium_since,
    pending,
    roles,
    flags,
    premium_type
FROM guild_members_cache;

-- View for roles with member counts (requires JOIN)
CREATE VIEW IF NOT EXISTS v_guild_roles AS
SELECT 
    r.*,
    (SELECT COUNT(*) FROM guild_members_cache m 
     WHERE m.guild_id = r.guild_id AND m.roles LIKE '%"' || r.role_id || '"%') as member_count
FROM guild_roles_cache r;
