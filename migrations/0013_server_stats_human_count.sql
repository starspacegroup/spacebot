-- Add human_count column to server_stats for non-bot member tracking
-- This stores the computed human member count (member_count - bot_count)

-- Add human_count column (computed value for easier querying)
ALTER TABLE server_stats ADD COLUMN human_count INTEGER DEFAULT NULL;

-- Add index for human_count queries
CREATE INDEX IF NOT EXISTS idx_server_stats_human_count ON server_stats(guild_id, human_count);

-- Note: To backfill existing data where bot_count is known:
-- UPDATE server_stats 
-- SET human_count = member_count - bot_count 
-- WHERE bot_count IS NOT NULL AND human_count IS NULL;
