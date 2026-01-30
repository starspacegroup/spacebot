-- Custom slash commands table
-- Commands share the action system with automations but have different triggers
CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL, -- Command name (lowercase, no spaces)
    description TEXT NOT NULL, -- Command description shown in Discord
    enabled INTEGER DEFAULT 1,
    
    -- Command configuration
    options TEXT, -- JSON: Discord slash command options (parameters)
    ephemeral INTEGER DEFAULT 0, -- Whether response is only visible to the user
    defer INTEGER DEFAULT 0, -- Whether to defer the response for long-running actions
    
    -- Action configuration (shared with automations)
    action_type TEXT NOT NULL, -- Action to perform (e.g., 'SEND_MESSAGE', 'ADD_ROLE')
    action_config TEXT NOT NULL, -- JSON: action-specific configuration
    
    -- Response configuration
    response_type TEXT DEFAULT 'message', -- 'message', 'embed', 'action_only'
    response_content TEXT, -- Template for response message
    response_embed TEXT, -- JSON: embed configuration
    
    -- Metadata
    registered INTEGER DEFAULT 0, -- Whether command is synced to Discord
    discord_command_id TEXT, -- Discord's command ID after registration
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    use_count INTEGER DEFAULT 0,
    last_used_at DATETIME,
    
    -- Constraints
    UNIQUE(guild_id, name)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_commands_guild_id ON commands(guild_id);
CREATE INDEX IF NOT EXISTS idx_commands_name ON commands(name);
CREATE INDEX IF NOT EXISTS idx_commands_enabled ON commands(enabled);
CREATE INDEX IF NOT EXISTS idx_commands_guild_name ON commands(guild_id, name);

-- Command execution logs
CREATE TABLE IF NOT EXISTS command_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT,
    channel_id TEXT,
    options_used TEXT, -- JSON: options provided by user
    action_result TEXT, -- JSON: result of the action
    success INTEGER DEFAULT 1,
    error_message TEXT,
    execution_time_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_command_logs_command_id ON command_logs(command_id);
CREATE INDEX IF NOT EXISTS idx_command_logs_guild_id ON command_logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_command_logs_user_id ON command_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_command_logs_created_at ON command_logs(created_at);
