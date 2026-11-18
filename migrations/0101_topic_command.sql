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
    '[{"name":"new","description":"Get a random topic of conversation","type":1,"options":[{"name":"kind","description":"What sort of topic (any if blank)","type":3,"required":false,"choices":[{"name":"Silly debates","value":"debate"},{"name":"Would you rather","value":"rather"},{"name":"Hypotheticals","value":"what_if"},{"name":"Food","value":"food"},{"name":"Everyday life","value":"life"}]}]},{"name":"settings","description":"Server options for /topic (Manage Server only)","type":1,"options":[{"name":"set_voice_status","description":"In a voice channel''s chat, also set the voice channel status to the topic","type":5,"required":true}]}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);

-- One row per server that changed an option. No row means every option is off.
CREATE TABLE IF NOT EXISTS topic_settings (
    guild_id TEXT PRIMARY KEY,
    set_voice_status INTEGER NOT NULL DEFAULT 0,
    last_topic TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
