-- Ship /room as a built-in command family.
--
-- Guilds do not hand-assemble ten subcommands: they enable /room and fill in a
-- preset (Server Settings -> Rooms). Per-guild enable/disable and a per-guild
-- permission gate already come from built_in_command_overrides (0037).
--
-- One command, one action per verb, each action fenced by a condition on the
-- reserved __subcommand key that the interaction handler now populates. Each
-- action sits in its own `group` because filterActionsByConditions applies the
-- first condition it finds in a group to every action in that group.

INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'room', 'Create and run your own channel', 1, 1,
    '[{"name":"create","description":"Make your own room","type":1,"options":[{"name":"name","description":"What to call it","type":3,"required":false},{"name":"limit","description":"Max people (voice rooms, 0 = no limit)","type":4,"required":false,"min_value":0,"max_value":99}]},{"name":"rename","description":"Rename your room","type":1,"options":[{"name":"name","description":"The new name","type":3,"required":true}]},{"name":"invite","description":"Let someone into your room","type":1,"options":[{"name":"user","description":"Who to let in","type":6,"required":true}]},{"name":"kick","description":"Remove someone from your room","type":1,"options":[{"name":"user","description":"Who to remove","type":6,"required":true}]},{"name":"lock","description":"Only invited people can get in","type":1},{"name":"unlock","description":"Back to the default access","type":1},{"name":"limit","description":"Set how many people can be in your room","type":1,"options":[{"name":"limit","description":"0 to 99, where 0 means no limit","type":4,"required":true,"min_value":0,"max_value":99}]},{"name":"transfer","description":"Hand your room to someone else","type":1,"options":[{"name":"user","description":"The new owner","type":6,"required":true}]},{"name":"extend","description":"Keep your room around a while longer","type":1},{"name":"delete","description":"Close your room now","type":1}]',
    1, 1,
    'MULTIPLE', '{"actions":[{"type":"CREATE_MANAGED_CHANNEL","group":"create","condition":{"mode":"if_equals","option":"__subcommand","value":"create"},"config":{"name":"{option.name}","user_limit":"option:limit"}},{"type":"MANAGE_MANAGED_CHANNEL","group":"rename","condition":{"mode":"if_equals","option":"__subcommand","value":"rename"},"config":{"verb":"rename","allow_moderators":true}},{"type":"MANAGE_MANAGED_CHANNEL","group":"invite","condition":{"mode":"if_equals","option":"__subcommand","value":"invite"},"config":{"verb":"invite","allow_moderators":true}},{"type":"MANAGE_MANAGED_CHANNEL","group":"kick","condition":{"mode":"if_equals","option":"__subcommand","value":"kick"},"config":{"verb":"kick","allow_moderators":true}},{"type":"MANAGE_MANAGED_CHANNEL","group":"lock","condition":{"mode":"if_equals","option":"__subcommand","value":"lock"},"config":{"verb":"lock","allow_moderators":true}},{"type":"MANAGE_MANAGED_CHANNEL","group":"unlock","condition":{"mode":"if_equals","option":"__subcommand","value":"unlock"},"config":{"verb":"unlock","allow_moderators":true}},{"type":"MANAGE_MANAGED_CHANNEL","group":"limit","condition":{"mode":"if_equals","option":"__subcommand","value":"limit"},"config":{"verb":"limit","allow_moderators":true}},{"type":"MANAGE_MANAGED_CHANNEL","group":"transfer","condition":{"mode":"if_equals","option":"__subcommand","value":"transfer"},"config":{"verb":"transfer","allow_moderators":true}},{"type":"MANAGE_MANAGED_CHANNEL","group":"extend","condition":{"mode":"if_equals","option":"__subcommand","value":"extend"},"config":{"verb":"extend","allow_moderators":true}},{"type":"MANAGE_MANAGED_CHANNEL","group":"delete","condition":{"mode":"if_equals","option":"__subcommand","value":"delete"},"config":{"verb":"delete","allow_moderators":true}}]}',
    'action_only', NULL, NULL,
    'system'
);
