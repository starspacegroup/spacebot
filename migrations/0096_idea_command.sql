-- /idea as a built-in command (David, 2026-11-07): ON for every server, anyone may use it, no
-- permission gate. A server owner can still switch it off from the Commands page (a
-- built_in_command_overrides row, as for /define). Handled by the interactions route in
-- src/lib/server/idea-command.ts; no action pipeline. The reply is private to the sender.
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'idea', 'Tell the SpaceBot team how to make it better', 1, 1,
    '[{"name":"text","description":"Your idea, in your own words","type":3,"required":true,"min_length":20,"max_length":2000},{"name":"area","description":"Which part of SpaceBot it is about","type":3,"required":false,"choices":[{"name":"Commands","value":"commands"},{"name":"Dashboard","value":"dashboard"},{"name":"Games","value":"games"},{"name":"Automations","value":"automations"},{"name":"Logging","value":"logging"},{"name":"Server browser","value":"server_browser"},{"name":"Something else","value":"other"}]},{"name":"title","description":"A short title (optional)","type":3,"required":false,"max_length":100}]',
    1, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);
