-- /about: one short piece of content a member keeps about themselves, set and
-- cleared with a built-in command and served back by the bot and the keyed API
-- (GET /api/v1/member-content). Handled directly by the interactions route like
-- /oldest (0075); per-guild enable/disable and permission gates come from
-- built_in_command_overrides as for every built-in.
--
-- `member_content_settings` holds the one role that may write, per guild. Until
-- an admin sets it with `/about role`, nobody may. `member_content` is one row
-- per (guild, member): plain text, never HTML.

CREATE TABLE IF NOT EXISTS member_content_settings (
    guild_id TEXT PRIMARY KEY,
    role_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_content (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, user_id)
);

INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'about', 'Keep a short piece of content about yourself, and read other members content', 1, 1,
    '[{"name":"set","description":"Set your own content (members with the contributor role)","type":1,"options":[{"name":"text","description":"What to keep, up to 500 characters","type":3,"required":true,"max_length":500}]},{"name":"clear","description":"Remove your own content","type":1},{"name":"show","description":"Read a member content (yours if blank)","type":1,"options":[{"name":"member","description":"Whose content to read","type":6,"required":false}]},{"name":"role","description":"Choose which role may set content (Manage Server)","type":1,"options":[{"name":"role","description":"The contributor role","type":8,"required":true}]}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);
