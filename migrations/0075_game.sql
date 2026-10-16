-- /game — a hidden-agent round for everyone in a voice channel.
--
-- Everyone in the round but one is told a secret word; one is the agent and is
-- not. They talk in voice, anyone can call a vote, and the table ejects who it
-- thinks the agent is. Planning: planning/IDEAS.md "Voice games".
--
-- `game_settings` is the per-server options, one row per guild; a NULL column
-- means "use the default". A round copies the options it needs when the lobby
-- opens, so changing a setting never changes a round that is already running.
--
-- One live round per voice channel, by a partial unique index: two people
-- pressing "start" at once cannot both win, and the loser is told why.

CREATE TABLE IF NOT EXISTS game_settings (
    guild_id TEXT PRIMARY KEY,
    agent_name TEXT,
    crew_name TEXT,
    min_players INTEGER,
    round_seconds INTEGER,
    call_lock_seconds INTEGER,
    meeting_seconds INTEGER,
    calls_per_player INTEGER,
    mute_out INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    voice_channel_id TEXT NOT NULL,       -- also the id of its text chat, where the cards post
    starter_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'lobby', -- 'lobby' | 'running' | 'ended'
    word TEXT,                            -- dealt at start; never sent to the agent
    agent_id TEXT,
    agent_name TEXT NOT NULL,             -- the server's name for the roles, as of the lobby
    crew_name TEXT NOT NULL,
    min_players INTEGER NOT NULL,
    round_seconds INTEGER NOT NULL,
    call_lock_seconds INTEGER NOT NULL,
    meeting_seconds INTEGER NOT NULL,
    calls_per_player INTEGER NOT NULL,
    mute_out INTEGER NOT NULL DEFAULT 1,  -- server-mute a player who is ejected
    message_id TEXT,                      -- the lobby card
    empty_since TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    ends_at TEXT,
    ended_at TEXT,
    result TEXT                           -- 'players' | 'agent_time' | 'agent_parity' | 'cancelled' | 'abandoned'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_rounds_live_voice
    ON game_rounds(guild_id, voice_channel_id) WHERE status IN ('lobby', 'running');
CREATE INDEX IF NOT EXISTS idx_game_rounds_status ON game_rounds(status);

CREATE TABLE IF NOT EXISTS game_players (
    round_id INTEGER NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,                            -- 'agent' | 'crew', dealt at start
    state TEXT NOT NULL DEFAULT 'in',     -- 'in' | 'ejected'
    calls_used INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    ejected_at TEXT,
    -- The mute the round put on an ejected player, and what it was before, so
    -- ending the round puts back exactly that: a player a moderator had already
    -- muted stays muted. `restore_pending` is a lift Discord refused (not in
    -- voice) that the sweep retries.
    muted INTEGER NOT NULL DEFAULT 0,
    prev_mute INTEGER NOT NULL DEFAULT 0,
    restore_pending INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (round_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_players_restore ON game_players(restore_pending) WHERE restore_pending = 1;

-- A called vote. One open meeting per round, by index.
CREATE TABLE IF NOT EXISTS game_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
    caller_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closes_at TEXT NOT NULL,
    closed_at TEXT,
    ejected_id TEXT                       -- NULL: nobody was ejected
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_meetings_open
    ON game_meetings(round_id) WHERE closed_at IS NULL;

-- One row per voter, updated in place while the meeting is open. `target` is a
-- player's id or 'skip'. Who voted for whom is never shown to the table.
CREATE TABLE IF NOT EXISTS game_votes (
    meeting_id INTEGER NOT NULL REFERENCES game_meetings(id) ON DELETE CASCADE,
    voter_id TEXT NOT NULL,
    target TEXT NOT NULL,
    PRIMARY KEY (meeting_id, voter_id)
);

-- /game as a built-in command family, like /timebox (0070). **Off by default**:
-- a server turns it on from the dashboard (Activity page), which writes a row to
-- built_in_command_overrides (0037).
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'game', 'A hidden-agent round for everyone in your voice channel', 0, 1,
    '[{"name":"start","description":"Open a lobby for the voice channel you are in","type":1},{"name":"stop","description":"End the round here (the starter or Crew)","type":1},{"name":"status","description":"Show the round here","type":1}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);
