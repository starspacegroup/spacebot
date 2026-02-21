-- Add is_built_in flag to commands table
-- Built-in commands are global (guild_id = '__built_in__') and only editable by superadmins
ALTER TABLE commands ADD COLUMN is_built_in INTEGER DEFAULT 0;

-- Seed built-in commands
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES
(
    '__built_in__', 'ping', 'Check if the bot is responsive', 1, 1,
    NULL, 0, 0,
    'NONE', '{}',
    'message', 'Pong! 🏓', NULL,
    'system'
),
(
    '__built_in__', 'info', 'View bot information and statistics', 1, 1,
    NULL, 0, 0,
    'NONE', '{}',
    'embed', NULL, '{"title":"📊 SpaceBot Info","color":5793266,"fields":[{"name":"⚡ Platform","value":"Cloudflare Workers","inline":true},{"name":"🔧 Framework","value":"SvelteKit","inline":true},{"name":"🌐 API Version","value":"Discord API v10","inline":true}],"footer":{"text":"SpaceBot • Powered by Starspace"}}',
    'system'
),
(
    '__built_in__', 'help', 'Get help with bot commands', 1, 1,
    NULL, 0, 0,
    'NONE', '{}',
    'embed', NULL, '{"title":"🚀 SpaceBot Help","description":"Welcome to SpaceBot! Use /ping to check if the bot is online, /info for bot details, and /help for this message. Custom commands are configured by your server admin.","color":5763399,"fields":[{"name":"🔗 Links","value":"[GitHub](https://github.com/starspacegroup/spacebot)","inline":false}],"footer":{"text":"Use /command to run a command"}}',
    'system'
);

-- Index for efficient built-in command lookup
CREATE INDEX IF NOT EXISTS idx_commands_built_in ON commands(is_built_in);
