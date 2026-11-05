-- /define and /synonym as built-in commands (David, 2026-11-05: server owners can turn on a few
-- basic default commands). OFF until a server enables it: enabled = 0 here, and a server turns
-- one on from the dashboard's Commands page, which writes a built_in_command_overrides row
-- (0037), as for /timebox (0070). Handled by the interactions route in
-- src/lib/server/word-commands.ts; no action pipeline. Anyone may use them once they are on.
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'define', 'Look up the definition of a word', 0, 1,
    '[{"name":"word","description":"The word to define","type":3,"required":true,"max_length":40}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);

INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'synonym', 'Find words that mean the same as another word', 0, 1,
    '[{"name":"word","description":"The word to find synonyms for","type":3,"required":true,"max_length":40}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);
