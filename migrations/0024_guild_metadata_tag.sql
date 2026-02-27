-- Add tag column to guild_metadata for Discord server/clan tags
ALTER TABLE guild_metadata ADD COLUMN tag TEXT DEFAULT NULL;
