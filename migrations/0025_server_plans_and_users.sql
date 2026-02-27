-- Server plans and tracked users tables
-- Plans define per-guild subscription tiers with feature limits
-- Users track anyone who has logged in via Discord OAuth

-- ============================================================
-- Server Plans
-- ============================================================
CREATE TABLE IF NOT EXISTS server_plans (
    guild_id TEXT PRIMARY KEY,

    -- Plan tier: 'free', 'pro', 'enterprise'
    plan TEXT NOT NULL DEFAULT 'free',

    -- Feature limits (NULL = unlimited)
    max_commands INTEGER DEFAULT 3,
    max_automations INTEGER DEFAULT 9,
    max_api_keys INTEGER DEFAULT 3,
    max_webhooks INTEGER DEFAULT 5,
    log_retention_days INTEGER DEFAULT 90,
    stats_retention_days INTEGER DEFAULT 90,

    -- Billing info (set by superadmin, not integrated with payment yet)
    price_cents INTEGER DEFAULT 0,         -- Monthly price in cents (0 = free)
    billing_email TEXT DEFAULT NULL,
    billing_notes TEXT DEFAULT NULL,

    -- Timestamps
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME DEFAULT NULL,       -- NULL = no expiry
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Tracked Users (populated on Discord OAuth login)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                    -- Discord user ID
    username TEXT NOT NULL,
    global_name TEXT DEFAULT NULL,
    avatar TEXT DEFAULT NULL,
    discriminator TEXT DEFAULT '0',
    email TEXT DEFAULT NULL,

    -- Access tracking
    is_superadmin INTEGER DEFAULT 0,        -- Computed / cached flag
    last_login_at DATETIME DEFAULT NULL,
    login_count INTEGER DEFAULT 1,

    -- Notes for superadmin
    notes TEXT DEFAULT NULL,
    banned INTEGER DEFAULT 0,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);
CREATE INDEX IF NOT EXISTS idx_server_plans_plan ON server_plans(plan);
CREATE INDEX IF NOT EXISTS idx_server_plans_expires ON server_plans(expires_at);
