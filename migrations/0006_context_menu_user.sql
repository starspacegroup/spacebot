-- Add context_menu_user column to commands table
-- When enabled, the command will also appear in the Apps menu when right-clicking a user
-- This creates a USER type (type 2) context menu command in addition to/instead of the slash command
ALTER TABLE commands ADD COLUMN context_menu_user INTEGER DEFAULT 0;

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_commands_context_menu_user ON commands(context_menu_user);
