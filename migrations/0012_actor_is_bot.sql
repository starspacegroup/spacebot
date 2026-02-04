-- Add actor_is_bot column to event_logs to properly filter out bot activity
ALTER TABLE event_logs ADD COLUMN actor_is_bot INTEGER DEFAULT 0;

-- Create index for efficient bot filtering
CREATE INDEX IF NOT EXISTS idx_event_logs_actor_is_bot ON event_logs(actor_is_bot);
