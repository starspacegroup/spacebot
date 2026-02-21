-- Track when an integration first connected (did its first sync handshake)
-- Integrations that have never connected won't appear as available to guild admins

ALTER TABLE integrations ADD COLUMN connected_at TEXT;
