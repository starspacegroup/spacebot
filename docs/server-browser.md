---
title: Public Server Browser
layout: default
---

# Public Server Browser

A public directory of Discord communities running SpaceBot, at
[`/servers`](https://spacebot.starspace.group/servers). Server administrators opt in from
their dashboard; nothing is published automatically.

## Opting in

**Admin → Server settings → Public server browser.** Requires the same full-administrator
permission as the rest of the settings page.

| Field                         | Notes                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| **List this server publicly** | The opt-in switch. **Off by default.**                                 |
| **Headline**                  | One line, ≤ 120 chars. Shown on the browser card. Required to publish. |
| **Description**               | Long form, ≤ 1000 chars. Shown on the server's public page.            |
| **Category**                  | One of the fixed slugs in `LISTING_CATEGORIES`.                        |
| **Tags**                      | Up to 8, comma separated, ≤ 24 chars each, deduped case-insensitively. |
| **Invite link**               | A Discord invite. Required to publish. Use a non-expiring invite.      |
| **Show member counts**        | On by default. Off drops member/online counts from the public payload. |
| **Mark as 18+**               | Hidden from the browser unless a visitor opts into 18+ listings.       |

Settings auto-save. If the publish switch is on while the headline or invite is missing,
the client holds the save and shows what's outstanding — the server rejects the same
combination, so the two agree.

### Draft it with AI

**Draft with AI** (`POST /api/admin/[serverId]/listing/suggest`) writes a first pass at the
headline, description, category and tags from the guild's own data — name, Discord
description, member count, features and channel names, which are the strongest signal for
what a server is actually for.

Two properties matter here:

- **It cannot publish.** The endpoint never writes `listed`; only the settings form does.
- **It does not save.** The draft fills the form and shows a review bar with **Keep
  draft** / **Discard**, and Discard restores a snapshot taken before the fill. On an
  already-published server, auto-saving would put machine-written copy live before anyone
  read it, so the admin decides explicitly.

Model output is clamped by `parseListingDraft` to exactly the limits a human submission
gets — length caps, a category from `LISTING_CATEGORIES`, tags through the shared
`parseTags` — so the model has no more latitude than someone typing. Asking for JSON in
one shot is not reliable (observed live: a small local model returned prose on its second
call), so a failed parse retries once with a blunter instruction before giving up.

Requests are capped per guild (10 per 10 minutes) via `consumeQuota`, independent of the
global `RATE_LIMIT_ENABLED` flag, because completions cost money.

### Generate invite

**Generate invite** (`POST /api/admin/[serverId]/listing/invite`) has the bot produce a
permanent invite, so the Join button can't be broken by an admin pasting a 7-day link. It
prefers what already exists before creating anything:

1. the guild's **vanity URL**, if it has one — permanent, branded, and costs no API call;
2. an **existing permanent invite** (`max_age` and `max_uses` both 0), preferring one the
   bot made, so clicking twice doesn't litter the server's invite list;
3. otherwise it **creates** one with `max_age: 0, max_uses: 0`, walking channels in a
   sensible order — rules channel, then system channel, then plain text by position.

Rather than computing permission overwrites, creation attempts each candidate and moves on
when a channel refuses; Discord is the authority. Failures are translated into something an
admin can act on ("check that the bot is still a member") instead of a bare `401`.

## What visitors see

The card and detail pages combine admin-authored copy with Discord-sourced identity
(name, icon, banner, member counts, boost tier) read from `guild_metadata`, which the
daily cron refreshes. Everything is rendered escaped — never route listing text through
`{@html}`.

The browse page supports search (`?q=`), category filter (`?category=`), sort
(`?sort=recent|members|name`), pagination (`?page=`), and an 18+ opt-in (`?nsfw=1`).
It is a plain GET form, so filtering works without JavaScript.

## Visibility rules

A guild appears in the browser only when **all** of these hold:

1. `guild_listings.listed = 1` — the admin opted in.
2. `guild_listings.review_status = 'approved'` — the operator hasn't hidden it.
3. `guild_metadata.fetched_at` is within `LISTING_FRESHNESS_DAYS` (7) — SpaceBot is
   still in the guild.

### Why (3) is a freshness check, not just a join

**Nothing ever deletes `guild_metadata` rows.** `runDailyRefresh` walks
`getBotGuilds(botToken)` and _upserts_, and the cleanup jobs only prune
`voice_sessions`, `aggregated_stats`, and `server_stats`. So "a row exists" is a
condition that is never false once true — a plain inner join would keep a server that
removed SpaceBot listed forever, with stale counts and a still-working invite link.

What does change is `fetched_at`, stamped `datetime('now')` by SQLite on every metadata
upsert. Only the bot-token refresh paths write it — the OAuth callback deliberately does
not (see the comment in `api/auth/discord/callback`) — so it means exactly "Discord last
confirmed the bot is in this guild at time T". A guild the bot has left stops being
refreshed, its `fetched_at` freezes, and the listing ages out within a week.

The 7-day window is a deliberate trade-off in both directions: the refresh runs daily, so
it tolerates a week of consecutive Discord outages or failed cron runs before delisting
anyone (a transient failure must not empty the directory), while a real removal cannot
stay published indefinitely.

**Consequence to keep in mind:** if the daily refresh stops running entirely, the whole
browser empties after a week. That is the intended fail-closed direction for a feature
whose model is consent — with no refresh we have no evidence any bot is still installed —
but it must not be _silent_, because "cron is broken" and "nobody opted in yet" both look
like an empty page.

**Superadmin → Public Server Browser** exists for exactly that: it reports opted-in vs.
actually-visible counts, how many are hidden by staleness vs. taken down, and raises a
warning when the whole fleet's metadata has gone stale. A widening gap between "Opted In"
and "Visible at /servers" means check the refresh job before you look at the listings.

> ⚠️ **Deployment prerequisite.** Cloudflare Pages cannot run cron triggers
> (`wrangler.toml` says so), and `src/lib/scheduled.ts` is unreferenced — nothing in this
> repo invokes `POST /api/cron` with `job=daily_refresh`. The refresh therefore runs only
> if an external scheduler or a superadmin workflow is configured to call it. Confirm that
> before relying on the browser, or every listing will age out within a week of launch.

### What is _not_ re-checked

Listings belong to the **server**, not to the person who published them. If the admin who
opted in later loses their permissions or leaves, the listing stays up — any current full
administrator can edit or unpublish it. Reducing SpaceBot's own permissions in the guild
also doesn't delist: `GET /guilds/{id}` keeps working while the bot is a member, and bot
membership — not permission level — is the consent signal. If a server ends up published
with nobody able to reach the dashboard, an operator takedown is the remedy.

All three conditions are enforced in SQL inside `src/lib/db/server-listings.ts`
(`PUBLIC_FROM`), not in the page loads, so a new caller can't accidentally publish an
unlisted server. `/servers/[guildId]` 404s for an unlisted guild exactly as it does for a
guild that doesn't exist — the response must not confirm that an unlisted server uses
SpaceBot.

## Moderation

`review_status` is operator state, not admin state:

- `approved` (default) — live.
- `rejected` — hidden from the browser. The admin's own opt-in switch is untouched, and
  the settings page shows a takedown notice with `review_note`.

`saveGuildListing` never writes `review_status`, so an admin editing their listing cannot
clear a takedown. Flipping it is currently a direct D1 operation:

```sql
UPDATE guild_listings
   SET review_status = 'rejected', review_note = 'Reason shown to the admin'
 WHERE guild_id = '…';
```

## Security notes

- **Invite links are allowlisted.** `normalizeInviteUrl` accepts only `discord.gg/<code>`
  and `discord.com/invite/<code>` (plus `www.`/`http`/`discordapp.com` variants) and
  canonicalizes them to `https://discord.gg/<code>`. Anything else is rejected at save
  time. Without this the directory would be an open redirector for whatever an admin
  pastes. Outbound links carry `rel="noopener noreferrer nofollow ugc"`.
- **Member counts are a disclosure toggle.** `toPublicListing` is the single choke point
  that turns a row into public data; when `show_member_count` is off it returns `null`
  counts rather than relying on the template to skip them.
- **Search terms are bound, not interpolated**, and `%`/`_`/`\` are escaped **with an
  explicit `ESCAPE '\'` clause**. SQLite's `LIKE` has no default escape character, so
  without that clause the backslashes are matched literally and the wildcards stay live —
  which silently returned zero results for any search containing one.
- **These pages must not be publicly cached.** `hooks.server.ts` already forces
  `no-store` on every HTML response, which is the correct behaviour here: the browser
  renders inside the app shell, which contains the signed-in user's menu, so a shared/CDN
  cache would serve one visitor's header to another. Don't add a `public` cache header to
  these loads — if the browse query ever needs caching, cache the query, not the HTML.

## Schema

`migrations/0059_public_server_listings.sql` creates `guild_listings`, keyed by
`guild_id`, with `idx_guild_listings_public (listed, review_status, listed_at DESC)` so
the browser's hot query stays off a full table scan — see the D1 rows-read notes in
`ROADMAP.md`.

`listed_at` is stamped the first time a server actually goes public and kept afterwards,
so "recently listed" ordering doesn't reshuffle every time an admin fixes a typo.

## Code map

| Path                                           | Role                                                        |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `src/lib/db/server-listings.ts`                | Validation, CRUD, public queries, public projection, health |
| `src/lib/ai/listing-draft.ts`                  | AI draft prompt, JSON parsing, retry                        |
| `src/lib/discord/invites.ts`                   | Permanent-invite resolution (vanity → existing → create)    |
| `src/routes/api/admin/[serverId]/listing/*`    | Draft + invite endpoints (full-admin gated, quota'd)        |
| `src/lib/server-listing-display.ts`            | Shared presentation helpers (initials, hue, counts)         |
| `src/routes/admin/superadmin/+page.*`          | Operator health panel                                       |
| `src/routes/servers/+page.*`                   | Browse page (search/filter/sort/paginate)                   |
| `src/routes/servers/[guildId]/+page.*`         | Public detail page                                          |
| `src/routes/admin/[serverId]/settings/+page.*` | Admin opt-in section                                        |
| `src/tests/server-listings.test.ts`            | Validation + visibility rule coverage                       |
