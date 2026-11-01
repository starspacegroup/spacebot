-- Shiritori, the English word chain. Plan: planning/SHIRITORI_PLAN.md.
--
-- Two ways to play. A Chain is an always-on channel: anyone posts the next word,
-- and a bad word breaks it. A Round is `/play shiritori`: a timed, turn-based
-- game with a lobby, where a miss puts you out.
--
-- Everything is **off by default** (`enabled` = 0 until a server turns it on).
-- Words are server game content, not personal data; the data-retention job
-- prunes word rows after 90 days and keeps the chain and round summaries.
--
-- The rules the database enforces, so two messages that race cannot both count:
--   * one open chain per channel          (partial unique index)
--   * one live round per channel          (partial unique index)
--   * a lemma is played once per game     (unique (chain_id, lemma))
--   * a position in a game is taken once  (unique (chain_id, seq))
-- The second of two racing inserts fails on the unique index, and the loser is
-- told "someone beat you to it".

CREATE TABLE IF NOT EXISTS shiritori_settings (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    chain_channel_id TEXT,                 -- NULL: no Chain channel
    turn_seconds INTEGER,                  -- Round: NULL means the default
    hard_mode INTEGER,                     -- the next word starts with the last TWO letters
    dead_letters TEXT,                     -- NULL: the default pool "xqjz"; letters, no separators
    allow_words TEXT,                      -- community words, one per line
    block_words TEXT,                      -- words this server refuses, one per line
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shiritori_chains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    dead_letter TEXT NOT NULL,
    hard_mode INTEGER NOT NULL DEFAULT 0,
    seed_word TEXT NOT NULL,               -- the word the chain starts from; not counted in `length`
    length INTEGER NOT NULL DEFAULT 0,     -- words members added
    last_word TEXT NOT NULL,               -- the word the next one must follow
    last_user_id TEXT,                     -- who played it; NULL until the first word
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    broken_by TEXT,                        -- the member whose word ended it
    reason TEXT                            -- 'not_a_word' | 'bad_start' | 'repeat' | 'blocked' | 'dead_letter' | 'reset'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shiritori_chains_open
    ON shiritori_chains(guild_id, channel_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shiritori_chains_guild ON shiritori_chains(guild_id, ended_at);

CREATE TABLE IF NOT EXISTS shiritori_words (
    chain_id INTEGER NOT NULL REFERENCES shiritori_chains(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,                  -- 1 for the first word a member added
    word TEXT NOT NULL,
    lemma TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_id TEXT,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chain_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shiritori_words_lemma ON shiritori_words(chain_id, lemma);
CREATE INDEX IF NOT EXISTS idx_shiritori_words_at ON shiritori_words(at);

CREATE TABLE IF NOT EXISTS shiritori_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,              -- the text channel the round is played in
    starter_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'lobby',  -- 'lobby' | 'running' | 'ended'
    dead_letter TEXT NOT NULL,
    hard_mode INTEGER NOT NULL DEFAULT 0,
    base_turn_seconds INTEGER NOT NULL,    -- the clock at the start of the round
    turn_seconds INTEGER NOT NULL,         -- the clock now; it drops by 1 each full lap
    lap INTEGER NOT NULL DEFAULT 0,
    turn_no INTEGER NOT NULL DEFAULT 0,    -- turns taken so far
    current_user_id TEXT,                  -- whose turn it is
    prev_word TEXT,                        -- NULL until the first word
    turn_ends_at TEXT,
    message_id TEXT,                       -- the lobby/status card
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    ended_at TEXT,
    result TEXT,                           -- 'winner' | 'cancelled' | 'abandoned'
    winner_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shiritori_rounds_live
    ON shiritori_rounds(guild_id, channel_id) WHERE status IN ('lobby', 'running');
CREATE INDEX IF NOT EXISTS idx_shiritori_rounds_status ON shiritori_rounds(status);

CREATE TABLE IF NOT EXISTS shiritori_players (
    round_id INTEGER NOT NULL REFERENCES shiritori_rounds(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    seat INTEGER,                          -- turn order, shuffled at the start
    state TEXT NOT NULL DEFAULT 'in',      -- 'in' | 'out'
    out_reason TEXT,                       -- 'not_a_word' | 'bad_start' | 'repeat' | 'blocked' | 'dead_letter' | 'timeout' | 'left'
    words INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    out_at TEXT,
    PRIMARY KEY (round_id, user_id)
);

CREATE TABLE IF NOT EXISTS shiritori_round_words (
    round_id INTEGER NOT NULL REFERENCES shiritori_rounds(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    word TEXT NOT NULL,
    lemma TEXT NOT NULL,
    user_id TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (round_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shiritori_round_words_lemma
    ON shiritori_round_words(round_id, lemma);
CREATE INDEX IF NOT EXISTS idx_shiritori_round_words_at ON shiritori_round_words(at);

-- Rolled-up per-member numbers for the leaderboard. Incremented as words land,
-- so a pruned word row never changes a total.
CREATE TABLE IF NOT EXISTS shiritori_member_stats (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    words_added INTEGER NOT NULL DEFAULT 0,
    chains_broken INTEGER NOT NULL DEFAULT 0,
    rounds_played INTEGER NOT NULL DEFAULT 0,
    rounds_won INTEGER NOT NULL DEFAULT 0,
    longest_word TEXT,
    PRIMARY KEY (guild_id, user_id)
);

-- `/play shiritori` joins the Game command family (0076, renamed 0077). The
-- built-in row keeps its id, so per-server overrides carry over; this adds the
-- subcommand to its options. A server still turns /play on from the dashboard.
UPDATE commands
   SET options = '[{"name":"start","description":"Open a lobby for the voice channel you are in","type":1},{"name":"stop","description":"End the round here (the starter or Crew)","type":1},{"name":"status","description":"Show the round here","type":1},{"name":"shiritori","description":"Open a word-chain round in this channel","type":1}]'
 WHERE guild_id = '__built_in__' AND name = 'play' AND is_built_in = 1;
