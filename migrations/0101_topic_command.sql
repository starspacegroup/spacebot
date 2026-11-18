-- /topic: a conversation starter ("Is a hotdog a sandwich?"). A built-in handled by the
-- interactions route (src/lib/server/topic-command.ts), OFF until a server turns it on from
-- Commands (enabled = 0, the same way /timebox ships; a built_in_command_overrides row turns it on).
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'topic', 'Get a random topic of conversation', 0, 1,
    '[{"name":"new","description":"Get a random topic of conversation","type":1,"options":[{"name":"kind","description":"What sort of topic (any if blank)","type":3,"required":false,"choices":[{"name":"Silly debates","value":"debate"},{"name":"Would you rather","value":"rather"},{"name":"Hypotheticals","value":"what_if"},{"name":"Food","value":"food"},{"name":"Everyday life","value":"life"}]}]},{"name":"settings","description":"Server options for /topic (Manage Server only)","type":1,"options":[{"name":"set_voice_status","description":"In a voice channel''s chat, also set the voice channel status to the topic","type":5,"required":false},{"name":"custom_only","description":"Use only this server''s own topics (once it has some)","type":5,"required":false}]},{"name":"add","description":"Add a topic to this server''s own list (Manage Server only)","type":1,"options":[{"name":"text","description":"The topic, up to 200 characters","type":3,"required":true,"max_length":200}]},{"name":"remove","description":"Remove a topic from this server''s list (Manage Server only)","type":1,"options":[{"name":"number","description":"Its number from /topic list","type":4,"required":true,"min_value":1}]},{"name":"list","description":"Show this server''s own topics (Manage Server only)","type":1}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);

-- One row per server that changed an option. No row means every option is off.
CREATE TABLE IF NOT EXISTS topic_settings (
    guild_id TEXT PRIMARY KEY,
    set_voice_status INTEGER NOT NULL DEFAULT 0,
    custom_only INTEGER NOT NULL DEFAULT 0,
    last_topic TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A server's own topics, added by people with Manage Server. They join the built-in list, or
-- replace it when topic_settings.custom_only is on.
CREATE TABLE IF NOT EXISTS topic_custom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    text TEXT NOT NULL,
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_topic_custom_guild ON topic_custom(guild_id);
