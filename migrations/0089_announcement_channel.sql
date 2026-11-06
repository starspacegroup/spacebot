-- The channel where SpaceBot posts announcements for a server: global changes and other
-- important alerts. Set by server managers on the Settings page. NULL means none, and
-- SpaceBot posts nothing there. Kept in its own column and written by its own query, so the
-- bulk settings save cannot clear it.
ALTER TABLE guild_settings ADD COLUMN announcement_channel_id TEXT;
