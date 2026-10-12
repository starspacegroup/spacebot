-- Quorum: one-command yes/no decisions that close themselves and post a result.
--
-- `quorum_questions` is one row per question, open or settled. Counts live on
-- the row; who voted does not. `quorum_votes` is the uniqueness check while a
-- question is open: an HMAC of the voter's id under the question's own salt,
-- paired with their current choice so a second press can change it. On close
-- the vote rows are deleted and the salt is nulled, so nothing left in the
-- database can be joined back to a person. `quorum_reminders` holds the ids of
-- members who pressed "Remind me before close" — a choice they made, unrelated
-- to how they voted — and is emptied as the reminders go out.
--
-- `quorum_settings` is per channel, with channel_id '' as the guild default:
-- how long a question stays open, how many votes it needs, the owner's footer,
-- where public results are mirrored, and which question classes are refused
-- outright (owner-only, money, access, legal) rather than vetoed after the fact.

CREATE TABLE IF NOT EXISTS quorum_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    asker_id TEXT NOT NULL,
    question TEXT NOT NULL,
    class TEXT,
    quorum INTEGER NOT NULL,
    closes_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    owner_kind TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'role'
    owner_id TEXT NOT NULL,
    salt TEXT,                                  -- NULL once closed
    yes_count INTEGER NOT NULL DEFAULT 0,
    no_count INTEGER NOT NULL DEFAULT 0,
    abstain_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',        -- 'open' | 'closed' | 'no_quorum' | 'vetoed'
    result TEXT,                                -- 'yes' | 'no' | 'tie' | NULL
    closed_reason TEXT,                         -- 'deadline' | 'early'
    closed_by TEXT,
    closed_at TEXT,
    result_message_id TEXT,
    veto_reason TEXT,
    vetoed_at TEXT,
    followup_status TEXT,                       -- NULL | 'asked' | 'done' | 'stale'
    followup_asked_at TEXT,
    followup_message_id TEXT,
    reminded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quorum_questions_open
    ON quorum_questions(status, closes_at);
CREATE INDEX IF NOT EXISTS idx_quorum_questions_channel
    ON quorum_questions(guild_id, channel_id, created_at);

CREATE TABLE IF NOT EXISTS quorum_votes (
    question_id INTEGER NOT NULL,
    voter_hash TEXT NOT NULL,
    choice TEXT NOT NULL,                       -- 'yes' | 'no' | 'abstain'
    PRIMARY KEY (question_id, voter_hash)
);

CREATE TABLE IF NOT EXISTS quorum_reminders (
    question_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (question_id, user_id)
);

CREATE TABLE IF NOT EXISTS quorum_settings (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL DEFAULT '',
    closes_minutes INTEGER,
    quorum INTEGER,
    footer_text TEXT,
    announce_channel_id TEXT,
    protected_classes TEXT,                     -- JSON array of class names
    classes_locked INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, channel_id)
);

-- /quorum as a built-in command family, like /room (0061): one command, the
-- verbs as subcommands, handled directly by the interactions route rather than
-- by the action pipeline, because a vote is state the bot keeps, not a
-- one-shot action. Per-guild enable/disable and permission gates come from
-- built_in_command_overrides as for every built-in.
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'quorum', 'Put a yes/no question to the server; it closes itself and posts the result', 1, 1,
    '[{"name":"ask","description":"Ask a yes/no question that closes by itself","type":1,"options":[{"name":"question","description":"The question, answerable yes or no","type":3,"required":true,"max_length":240},{"name":"closes","description":"How long it stays open, e.g. 24h, 90m, 2d (channel default if blank)","type":3,"required":false},{"name":"quorum","description":"Votes needed for a result (channel default if blank)","type":4,"required":false,"min_value":1,"max_value":10000},{"name":"owner","description":"Who follows through on the result (you, if blank)","type":9,"required":false},{"name":"due","description":"How long after closing the owner has, e.g. 7d (default 7d)","type":3,"required":false},{"name":"class","description":"What kind of decision this is","type":3,"required":false,"choices":[{"name":"General","value":"general"},{"name":"Owner-only","value":"owner-only"},{"name":"Money","value":"money"},{"name":"Access / roles","value":"access"},{"name":"Legal","value":"legal"}]}]},{"name":"close","description":"End a question early (asker or Crew)","type":1,"options":[{"name":"id","description":"Question number (the latest open one here if blank)","type":4,"required":false,"min_value":1}]},{"name":"results","description":"Repost the last result in this channel","type":1},{"name":"log","description":"Past decisions, newest first","type":1},{"name":"veto","description":"Stop a decision, with a public reason (server owner only)","type":1,"options":[{"name":"id","description":"Question number","type":4,"required":true,"min_value":1},{"name":"reason","description":"One line of why","type":3,"required":true,"max_length":300}]},{"name":"settings","description":"Defaults for this channel (Crew only)","type":1,"options":[{"name":"closes","description":"Default open time, e.g. 24h","type":3,"required":false},{"name":"quorum","description":"Default votes needed","type":4,"required":false,"min_value":1,"max_value":10000},{"name":"footer","description":"Footer on every RESULT card (server-wide)","type":3,"required":false,"max_length":120},{"name":"announce","description":"Channel to mirror results into (server-wide)","type":7,"required":false},{"name":"protect","description":"Comma-separated classes to refuse: owner-only, money, access, legal, or none (server-wide)","type":3,"required":false},{"name":"lock","description":"Lock the protected list so only the owner can change it (owner only)","type":5,"required":false}]}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);
