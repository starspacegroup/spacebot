-- Integration status tracking and authentication tokens
-- Allows external projects to authenticate with SpaceBot and report their status

-- Add token column for integration-to-SpaceBot authentication
ALTER TABLE integrations ADD COLUMN token TEXT;

-- Add status tracking columns
ALTER TABLE integrations ADD COLUMN status TEXT DEFAULT 'unknown';
ALTER TABLE integrations ADD COLUMN last_heartbeat_at TEXT;
ALTER TABLE integrations ADD COLUMN health_endpoint TEXT;

-- Index for token lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_token ON integrations(token);
