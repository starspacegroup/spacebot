# Site traffic

A superadmin page at **Superadmin → Site traffic** shows how the public pages and the server browser are doing. It has three tabs, and only the tab on screen loads its data:

- **Overview**: views over time (with "up 12% vs the window before"), the path from the home page to an install, and the busiest pages.
- **Server browser**: how the public listings perform. See below.
- **Audience**: where visitors come from, which countries, what devices, systems, browsers and languages.

It counts only the public pages: home, invite, servers, docs, leaderboards, support, vote, sign-in, and the privacy and terms pages. It never counts the dashboard, the Activity, or the API. The list is a fixed allowlist (`MARKETING_ROUTES` in `src/lib/server/site-traffic.ts`), so a new page is not counted until someone adds it.

## What is stored

Daily totals only, in six counter tables (migration `0084`). Nothing per visitor: no cookies, no IP address, no identifier, no row per visit, no raw User-Agent. The request's headers are read once, turned into a short fixed label (`Windows`, `Firefox`, `mobile`, `en-US`) and dropped. The page is the route name (`/servers/[guildId]`), never the URL, so an address and a query string cannot end up in the table. The referrer is stored as a host only. The country is the one Cloudflare reports.

Because of that, the site needs no consent banner for this, and the privacy page says what is counted.

Old rows are deleted after 400 days by the hourly cron job.

## Reading it

- **Windows:** 24 hours (drawn as 24 hourly bars), 7, 30 and 90 days. The window is in the link, so it survives a reload.
- **Bots** are left out by a User-Agent check. It is cheap and not adversarial, so a determined scraper can still be counted.
- **"From signed-in members"** is the share of views that carried a SpaceBot session cookie. It counts views, not people.
- **The funnel** has five steps: home page views, invite page views, sign-ins started, installs started and installs finished. Each is its own total. A percentage between two steps is a ratio of totals, not a conversion rate, because nothing follows one person from step to step.

Counting began when this shipped, so earlier dates are empty.

## Server browser stats

Migration `0091` adds `site_listing_daily`: one row per listing per UTC day with three counters (`src/lib/server/browser-stats.ts`).

- **Cards seen (impressions)**: the listing's card was on a browser page that loaded. Counted in the `/servers` page load, once per card shown.
- **Server pages opened (views)**: the listing's own page, `/servers/{id}`, loaded.
- **Joins**: someone pressed Join. The button now points at `/servers/{id}/join`, which counts the press and redirects to the invite the server chose. It only redirects for a listing that is public right now, and the target is the stored invite, never a value from the request. Crawlers are told not to follow it (`robots.txt`).

Bots (the User-Agent check above) and browser prefetches are not counted. Category use goes to `site_dimension_daily` (`browse_category`, a closed list) and searches to `site_event_daily` (`browse_search`, a count): **the words typed are never stored.** Nothing here is per visitor. The numbers appear on the Server browser tab as totals with the change against the window before, a trend chart, the card to join path, a table of every listing (sortable by joins, views, seen, join rate or members, with live listings that nobody opened included and hidden ones marked "not live"), and a category table with how often each category was filtered by.

Counts are taken when a page's data loads, so a client-side move between browser pages counts too, while the "page views" in the path text are full page loads. A percentage between two steps is a ratio of totals, not one person followed through. Counting began when this shipped. Rows are pruned after 400 days with the rest.

## Adding a page

Add its route id to `MARKETING_ROUTES`. Anything inside the product (admin, account, profile, Activity, API) should stay out.
