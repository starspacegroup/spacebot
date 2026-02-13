-- Add require_voice column to commands table
-- When enabled, the command can only be used by members currently in a voice channel
-- The user's current voice channel will be available as {voice_channel.*} template variables
ALTER TABLE commands ADD COLUMN require_voice INTEGER DEFAULT 0;
