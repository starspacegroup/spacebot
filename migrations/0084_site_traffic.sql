-- First-party traffic counters for SpaceBot's public marketing pages.
--
-- Everything here is a daily AGGREGATE counter written by the siteTraffic hook.
-- There are no raw request rows, no cookies, no identifiers and no IP addresses.
-- Only the public pages are counted (see MARKETING_ROUTES in
-- src/lib/server/site-traffic.ts): never the dashboard, the Activity or the API.
--
-- Cardinality is bounded by construction: path_key is the SvelteKit ROUTE ID
-- ('/servers/[guildId]'), never the URL; referrers are host-only; country is the
-- edge's ISO code; audience values come from a small closed vocabulary.
-- Pruned by the hourly cron job (retention in site-traffic.ts).

CREATE TABLE IF NOT EXISTS site_view_daily (
	day TEXT NOT NULL,           -- 'YYYY-MM-DD' (UTC)
	path_key TEXT NOT NULL,      -- SvelteKit route id
	views INTEGER NOT NULL DEFAULT 0,
	-- Views by someone with a SpaceBot session cookie. Views, not visitors:
	-- there are no visitors to count.
	signed_in INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, path_key)
);

-- Totals-only hourly counters, so the "1 day" window has 24 real buckets.
CREATE TABLE IF NOT EXISTS site_view_hourly (
	day TEXT NOT NULL,
	hour INTEGER NOT NULL,       -- 0-23 (UTC)
	views INTEGER NOT NULL DEFAULT 0,
	signed_in INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, hour)
);

CREATE TABLE IF NOT EXISTS site_referrer_daily (
	day TEXT NOT NULL,
	referrer_host TEXT NOT NULL, -- bare host, or '(direct)'
	views INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, referrer_host)
);

CREATE TABLE IF NOT EXISTS site_country_daily (
	day TEXT NOT NULL,
	country TEXT NOT NULL,       -- ISO 3166-1 alpha-2, 'T1' (Tor) or '(unknown)'
	views INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, country)
);

-- One table for every low-cardinality audience dimension:
-- os | browser | device | language.
CREATE TABLE IF NOT EXISTS site_dimension_daily (
	day TEXT NOT NULL,
	dimension TEXT NOT NULL,
	value TEXT NOT NULL,
	views INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, dimension, value)
);

-- Funnel steps that are not page views: login_start, install_start,
-- install_done. A count a day, nothing about who.
CREATE TABLE IF NOT EXISTS site_event_daily (
	day TEXT NOT NULL,
	event TEXT NOT NULL,
	count INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, event)
);
