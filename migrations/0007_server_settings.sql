-- Extend guild_settings table with additional configuration options
-- Add prefix for text commands
ALTER TABLE guild_settings ADD COLUMN prefix TEXT DEFAULT '!';

-- Add moderation role
ALTER TABLE guild_settings ADD COLUMN moderation_role_id TEXT;

-- Add welcome message settings
ALTER TABLE guild_settings ADD COLUMN welcome_enabled INTEGER DEFAULT 0;
ALTER TABLE guild_settings ADD COLUMN welcome_channel_id TEXT;
ALTER TABLE guild_settings ADD COLUMN welcome_message TEXT DEFAULT 'Welcome {user} to {server}!';

-- Add permission settings for web dashboard (JSON)
ALTER TABLE guild_settings ADD COLUMN permission_settings TEXT;
