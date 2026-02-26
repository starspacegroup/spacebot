-- Add timezone override setting for each server
-- When set, all dates/times in the dashboard for this server will be displayed in this timezone
-- When NULL, the user's browser timezone is used (default behavior)
ALTER TABLE guild_settings ADD COLUMN timezone TEXT DEFAULT NULL;
