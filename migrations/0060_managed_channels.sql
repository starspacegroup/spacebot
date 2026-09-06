-- Self-service (member-owned) channels: presets, ownership, and expiry.
--
-- A guild admin defines a *preset* — what kind of channel gets made, where,
-- named how, who may make one, what the creator may then do to it, and how it
-- ends. A member creating a room from that preset gets a row in
-- `managed_channels`, which is what authorizes every later verb and what the
-- reaper scans.
--
-- Deliberately NOT called a template: `commands.source_template_key` (0058)
-- means an integration command template, which is *cloned* with no live link.
-- A preset is the opposite — editing it governs rooms created afterwards, and
-- the reaper reads its policy at run time.

CREATE TABLE IF NOT EXISTS channel_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,

    name TEXT NOT NULL,                       -- admin-facing label ("Study Room")
    enabled INTEGER NOT NULL DEFAULT 1,

    -- Shape of the channel that gets created
    channel_type INTEGER NOT NULL DEFAULT 2,  -- 2 = voice, 0 = text
    parent_id TEXT,                           -- category to create under
    name_pattern TEXT NOT NULL DEFAULT '{user.name}''s room',
    default_user_limit INTEGER,               -- voice only, 0/NULL = unlimited

    -- Join-to-create: joining this voice channel makes a room and moves the
    -- member into it. NULL disables the lobby for this preset.
    lobby_channel_id TEXT,

    -- Who may create a room from this preset. Empty allow list = anyone who
    -- passes the command's own permission gate. Discord's per-command role
    -- permissions cannot be set with a bot token, so this is enforced here.
    allow_role_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array of role ids
    deny_role_ids TEXT NOT NULL DEFAULT '[]',    -- JSON array of role ids

    -- Lifetime. 'fixed' = delete ttl_minutes after creation; 'idle' = delete
    -- after the room has been empty for idle_minutes; 'manual' = never reap.
    lifetime_mode TEXT NOT NULL DEFAULT 'idle',
    ttl_minutes INTEGER NOT NULL DEFAULT 120,
    idle_minutes INTEGER NOT NULL DEFAULT 15,
    -- Never reap a room this new, so a room does not vanish between being
    -- created and its creator finishing the connection handshake.
    grace_minutes INTEGER NOT NULL DEFAULT 5,
    extend_minutes INTEGER NOT NULL DEFAULT 30,
    max_extensions INTEGER NOT NULL DEFAULT 2,

    -- Caps. per_guild also protects Discord's own structural limits
    -- (500 channels per guild, 50 children per category).
    max_per_user INTEGER NOT NULL DEFAULT 1,
    max_per_guild INTEGER NOT NULL DEFAULT 25,
    -- Discord throttles channel renames to 2 per 10 minutes per channel; the
    -- REST client would sit on the 429 rather than fail fast, so cap it here.
    max_renames INTEGER NOT NULL DEFAULT 2,

    -- What the creator may do to their own room (JSON array of verb slugs:
    -- rename, invite, kick, lock, limit, transfer, delete, extend).
    owner_can TEXT NOT NULL DEFAULT '["rename","invite","kick","lock","limit","extend","delete"]',

    -- Permission overwrites applied at creation. Named permission flags, not
    -- bitfields, so the dashboard stays readable. MANAGE_CHANNELS is
    -- deliberately not granted: every verb runs through the bot with an
    -- ownership check, and granting it would let the owner edit permissions
    -- and delete the channel out from under this table.
    owner_allow TEXT NOT NULL DEFAULT '["VIEW_CHANNEL","CONNECT"]',
    everyone_deny TEXT NOT NULL DEFAULT '["VIEW_CHANNEL","CONNECT"]',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_channel_presets_guild ON channel_presets(guild_id, enabled);

-- One lobby channel drives at most one preset, or joining it would be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_presets_lobby
    ON channel_presets(lobby_channel_id)
    WHERE lobby_channel_id IS NOT NULL;

-- One row per room the bot created and still owns the lifecycle of.
CREATE TABLE IF NOT EXISTS managed_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL UNIQUE,
    preset_id INTEGER,

    owner_user_id TEXT NOT NULL,
    owner_user_name TEXT,

    channel_name TEXT,
    channel_type INTEGER NOT NULL DEFAULT 2,

    -- active | closed. A room whose channel vanished from Discord is closed
    -- with close_reason = 'channel_deleted', never left dangling.
    status TEXT NOT NULL DEFAULT 'active',

    -- Fixed-lifetime deadline. NULL for idle/manual rooms.
    expires_at DATETIME,
    -- Idle bookkeeping: when the room was last seen with a human in it, and
    -- when it went empty (NULL while occupied).
    last_occupied_at DATETIME,
    empty_since DATETIME,

    extensions_used INTEGER NOT NULL DEFAULT 0,
    renames_used INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    close_reason TEXT,

    FOREIGN KEY (preset_id) REFERENCES channel_presets(id) ON DELETE SET NULL
);

-- The reaper's only scan: active rooms, cheapest first. Kept narrow because
-- per-minute whole-guild scanning was already the largest D1 rows-read source
-- on this account (see the note above postVoiceSessionSnapshot in gateway.ts).
CREATE INDEX IF NOT EXISTS idx_managed_channels_reap
    ON managed_channels(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_managed_channels_guild
    ON managed_channels(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_managed_channels_owner
    ON managed_channels(guild_id, owner_user_id, status);

-- Occupancy is read from live_voice_states, which counted bots — so a music
-- bot alone in an abandoned room read as "occupied" and the room would never
-- reap. Same column the occupancy trigger (#39) needs.
ALTER TABLE live_voice_states ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
