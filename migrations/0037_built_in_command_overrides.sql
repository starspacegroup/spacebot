-- Per-guild overrides for built-in commands
-- Allows server admins to disable built-in commands and customize permission restrictions
-- without modifying the global built-in command definitions.

CREATE TABLE IF NOT EXISTS built_in_command_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    command_id INTEGER NOT NULL,
    enabled INTEGER,
    default_member_permissions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, command_id),
    FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bico_guild_id ON built_in_command_overrides(guild_id);
CREATE INDEX IF NOT EXISTS idx_bico_command_id ON built_in_command_overrides(command_id);
