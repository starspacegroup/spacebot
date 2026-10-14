-- Timebox: focus and break timers, alone or for a whole voice channel.
--
-- `timebox_sessions` is one row per timebox, running or finished. The minute
-- sweep reads the running ones and moves each to its next block when
-- `phase_ends_at` has passed; the countdown on the card is Discord's own
-- `<t:unix:R>`, so nothing edits it per second. A paused session keeps its
-- remaining time in `paused_remaining_ms` and has no end time.
--
-- `timebox_participants` is the voice-state ledger for "deafen me". It records
-- what the member's server-deafen was *before* the bot touched it (`prev_deaf`)
-- so the end puts that back instead of clearing it: a member a moderator had
-- already deafened stays deafened. `applied` says the bot is holding a deafen
-- right now; `restore_pending` says it must lift one and could not yet (Discord
-- only changes a member who is in a voice channel), so the sweep keeps trying.
--
-- `timebox_settings` is the per-server defaults, one row per guild.

CREATE TABLE IF NOT EXISTS timebox_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,              -- where the card lives
    voice_channel_id TEXT,                 -- NULL for a solo timebox
    kind TEXT NOT NULL DEFAULT 'solo',     -- 'solo' | 'shared'
    starter_id TEXT NOT NULL,
    focus_minutes INTEGER NOT NULL,
    break_minutes INTEGER NOT NULL,
    long_break_minutes INTEGER NOT NULL,
    rounds INTEGER NOT NULL,
    control TEXT NOT NULL DEFAULT 'crew',  -- 'crew' | 'anyone', who may pause/skip/stop
    phase TEXT NOT NULL DEFAULT 'focus',   -- 'focus' | 'break' | 'long_break'
    block_number INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'running',-- 'running' | 'paused' | 'done' | 'stopped'
    phase_started_at TEXT NOT NULL,
    phase_ends_at TEXT,                    -- NULL while paused
    paused_remaining_ms INTEGER,
    message_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    end_reason TEXT,                       -- 'finished' | 'stopped' | 'empty'
    empty_since TEXT,                      -- a shared session with nobody in the VC
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_timebox_sessions_live
    ON timebox_sessions(status, phase_ends_at);
CREATE INDEX IF NOT EXISTS idx_timebox_sessions_channel
    ON timebox_sessions(guild_id, channel_id, status);

CREATE TABLE IF NOT EXISTS timebox_participants (
    session_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    deafen_mode TEXT NOT NULL DEFAULT 'none', -- 'none' | 'focus' | 'whole'
    prev_deaf INTEGER NOT NULL DEFAULT 0,
    applied INTEGER NOT NULL DEFAULT 0,
    restore_pending INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_timebox_participants_held
    ON timebox_participants(applied, restore_pending);

CREATE TABLE IF NOT EXISTS timebox_settings (
    guild_id TEXT PRIMARY KEY,
    focus_minutes INTEGER,
    break_minutes INTEGER,
    long_break_minutes INTEGER,
    rounds INTEGER,
    control TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- /timebox as a built-in command family, like /room (0061): one command, the
-- verbs as subcommands, handled by the interactions route. **Off by default**
-- (enabled = 0): a server turns it on from the dashboard, which writes a row to
-- built_in_command_overrides (0037), and Discord does not show the command in
-- servers that have not.
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'timebox', 'Focus and break timers, alone or for everyone in your voice channel', 0, 1,
    '[{"name":"start","description":"Start a focus timer: alone, or for everyone in your voice channel","type":1,"options":[{"name":"focus","description":"Minutes of focus per block (server default if blank)","type":4,"required":false,"min_value":1,"max_value":180},{"name":"break","description":"Minutes of break after a block","type":4,"required":false,"min_value":1,"max_value":60},{"name":"long_break","description":"Minutes of the long break after every fourth block","type":4,"required":false,"min_value":1,"max_value":120},{"name":"rounds","description":"How many focus blocks, then it finishes","type":4,"required":false,"min_value":1,"max_value":12},{"name":"deafen","description":"Server-deafen me while I focus. You can lift it any time with the button","type":3,"required":false,"choices":[{"name":"No","value":"none"},{"name":"During each focus block","value":"focus"},{"name":"Until the whole timebox ends","value":"whole"}]},{"name":"solo","description":"Just me, even if I''m in a voice channel","type":5,"required":false}]},{"name":"stop","description":"End the timebox running here","type":1},{"name":"status","description":"Show the timebox running here","type":1},{"name":"settings","description":"Defaults for this server (Crew only)","type":1,"options":[{"name":"focus","description":"Default minutes of focus","type":4,"required":false,"min_value":1,"max_value":180},{"name":"break","description":"Default minutes of break","type":4,"required":false,"min_value":1,"max_value":60},{"name":"long_break","description":"Default minutes of the long break","type":4,"required":false,"min_value":1,"max_value":120},{"name":"rounds","description":"Default number of focus blocks","type":4,"required":false,"min_value":1,"max_value":12},{"name":"control","description":"Who can pause, skip and stop a shared timebox","type":3,"required":false,"choices":[{"name":"The starter and Crew","value":"crew"},{"name":"Anyone in the voice channel","value":"anyone"}]}]}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);
