-- Add context_menu_message column to commands table
-- When enabled, the command will also appear in the Apps menu when right-clicking a message
-- This creates a MESSAGE type (type 3) context menu command in addition to the slash command.
-- Mirrors context_menu_user (type 2 / right-click a user) added in 0006.
ALTER TABLE commands ADD COLUMN context_menu_message INTEGER DEFAULT 0;

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_commands_context_menu_message ON commands(context_menu_message);
