-- Integration platform events (Part B): route an integration's platform-wide
-- events (e.g. AgapeVerse poem_created / account_created) to a single
-- designated "official" Discord guild. Superadmin sets this when registering
-- the integration. NULL = the integration has no official guild and its
-- inbound events are rejected.
ALTER TABLE integrations ADD COLUMN official_guild_id TEXT;

CREATE INDEX IF NOT EXISTS idx_integrations_official_guild
  ON integrations (official_guild_id);
