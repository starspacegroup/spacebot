# Site traffic

A superadmin page at **Superadmin → Site traffic** shows how the public pages are doing: views over time, which pages, where visitors come from, which countries, what devices and browsers, and how many sign-ins and installs followed.

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

## Adding a page

Add its route id to `MARKETING_ROUTES`. Anything inside the product (admin, account, profile, Activity, API) should stay out.
