-- Drop welcome message columns from guild_settings
ALTER TABLE guild_settings DROP COLUMN welcome_enabled;
ALTER TABLE guild_settings DROP COLUMN welcome_channel_id;
ALTER TABLE guild_settings DROP COLUMN welcome_message;
