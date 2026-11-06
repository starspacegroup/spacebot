-- Server browser counters, per listing and per day (superadmin Site traffic -> Server browser).
--
-- Like the other site_* tables these are COUNTERS: no visitor, cookie, IP address or
-- User-Agent is stored. One row per listing per UTC day holds three numbers:
--   impressions  the listing's card was on a browser page that loaded
--   views        its own page (/servers/<id>) loaded
--   joins        someone pressed Join (the button goes through /servers/<id>/join, which
--                counts and then redirects to the invite the server chose)
-- The guild id is public already (it is in the listing's address). Pruned with the others
-- after RETENTION_DAYS.
CREATE TABLE IF NOT EXISTS site_listing_daily (
	day TEXT NOT NULL,           -- 'YYYY-MM-DD' (UTC)
	guild_id TEXT NOT NULL,
	impressions INTEGER NOT NULL DEFAULT 0,
	views INTEGER NOT NULL DEFAULT 0,
	joins INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, guild_id)
);
CREATE INDEX IF NOT EXISTS idx_site_listing_daily_guild ON site_listing_daily (guild_id, day);
