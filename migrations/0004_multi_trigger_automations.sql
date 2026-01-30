-- Migration: Support multiple trigger events per automation
-- This changes trigger_event (single) to trigger_events (JSON array)

-- Add the new column for multiple trigger events
ALTER TABLE automations ADD COLUMN trigger_events TEXT;

-- Migrate existing single trigger_event to trigger_events array
UPDATE automations 
SET trigger_events = json_array(trigger_event)
WHERE trigger_event IS NOT NULL AND trigger_events IS NULL;

-- Create index for searching within trigger_events
-- Note: SQLite doesn't support array indexing, but we can still use json_each for queries
CREATE INDEX IF NOT EXISTS idx_automations_guild_enabled ON automations(guild_id, enabled);
