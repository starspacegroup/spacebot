-- /oldest as a built-in command, like /quorum (0069): handled directly by the
-- interactions route, answered from guild_members_cache, no action pipeline.
-- Not in ALWAYS_ENABLED_BUILT_INS: it is a toy and a server may turn it off.
-- Per-guild enable/disable and permission gates come from
-- built_in_command_overrides as for every built-in.
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'oldest', 'Who has been on Discord, or in this server, the longest', 1, 1,
    '[{"name":"show","description":"Which ranking (oldest accounts if blank)","type":3,"required":false,"choices":[{"name":"Oldest accounts","value":"account"},{"name":"Newest accounts","value":"newest"},{"name":"Longest in this server","value":"members"}]}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);
