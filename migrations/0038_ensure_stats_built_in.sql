-- Ensure the /stats built-in command exists.
-- Some environments were seeded before /stats was added to built-in defaults.

INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'stats', 'Show server stats charts and voice leaderboards', 1, 1,
    '[{"name":"type","description":"Which stats to show","type":3,"required":false,"choices":[{"name":"Voice Leaderboard","value":"voice_leaderboard"},{"name":"Voice Time","value":"voice_time"},{"name":"Voice Users","value":"voice_users"},{"name":"Voice Peak","value":"voice_peak"},{"name":"Member Count","value":"member_count"},{"name":"Member Growth","value":"member_growth"},{"name":"Member Joins","value":"member_joins"},{"name":"Member Leaves","value":"member_leaves"},{"name":"Member Net Change","value":"member_net_change"},{"name":"Message Count","value":"message_count"},{"name":"Message Authors","value":"message_users"}]},{"name":"period","description":"Time period","type":3,"required":false,"choices":[{"name":"Last 30 days","value":"30d"},{"name":"Last 7 days","value":"7d"}]}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);
