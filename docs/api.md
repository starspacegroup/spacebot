---
title: SpaceBot API
layout: default
---

# SpaceBot API

The stable external API lives under `/api/v1/*` and uses `Authorization: Bearer sb_live_...` API keys.

The machine-readable OpenAPI document is available at `/api/openapi.json` and can be regenerated into `docs/generated/openapi.json` with:

```bash
bun run docs:api
```

## Error Shape

Errors return JSON with a top-level `error` string. Rate-limited requests return HTTP 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

## Endpoints

- `GET /api/v1/stats?days=30` requires `stats:read`.
- `GET /api/v1/stats/members?period=30d&granularity=auto` requires `stats:read`.
  The member-count series for a graph: one point per bucket, each the last
  `server_stats` snapshot in that bucket, with `member_count`, `online_count`,
  `human_count` and `recorded_at`. `period` is `24h`, `<N>d`, `1y` or `all`;
  `granularity` is `auto` (hourly to 2 days, daily to 60, weekly beyond),
  `hourly`, `daily` or `weekly`. Anything else is a 400 rather than a silent
  fallback. Retention keeps 90 days of snapshots, so longer periods return what
  remains.
- `GET /api/v1/settings` requires `settings:read`.
- `GET /api/v1/commands` requires `commands:read`.
- `GET /api/v1/automations` requires `automations:read`.
- `GET /api/v1/integrations/status` reads integration status.
- `GET /api/stats/:guildId/export?format=json|csv` exports admin-authenticated report data.

## Integrations

Discord signed interactions at `/api/discord/interactions` are signature-verified and exempt from app rate limits. Runner WebSocket upgrade paths are also exempt.

## Connect: one-click authorization

A site can get an API key without anyone minting and pasting one. SpaceBot acts
as the authorization server: the site sends a server admin to a consent screen,
they approve scopes for one of their servers, and the site exchanges a one-time
code for a key over a server-to-server call.

**The key never travels through a browser.** What comes back through the
redirect is a code, which is worthless without the client secret.

### 1. Register the application

One command, which prints the environment lines to paste:

```bash
bun run connect:register -- \
  --client-id starspace-website \
  --name "*Space" \
  --redirect-uri https://starspace.group/admin/spacebot/callback \
  --scope voice:read --scope stats:read
```

Add `--local` to register against the local D1 instead of production. There is
also Superadmin → **Connect Apps** for the same thing in the browser, plus
enabling, disabling and deleting.

Either way you provide a client id, a display name (this is what admins see and
approve), the exact redirect URIs the app may receive a code at, and the scopes
it may ever request. The client secret is shown once and stored only as a
SHA-256 hash.

`redirect_uris` is matched **exactly**, not by prefix or host. That allowlist is
the whole defence against this flow being used to harvest keys — an
unregistered redirect URI is refused on the consent page and never redirected
to.

### 2. Send the admin to the consent screen

```
GET https://spacebot.starspace.group/connect
  ?client_id=<your client id>
  &redirect_uri=<one of your registered URIs>
  &scope=voice:read%20stats:read
  &state=<random, held in an httpOnly cookie on your side>
```

`state` is required. Generate it per attempt, store it where only your server
can read it, and refuse a callback that does not match — without it, a link
someone else crafted can complete a connection to a SpaceBot you did not choose.

The admin picks which of their servers to grant, and may untick scopes. The
request can never exceed the registration, and the approval can never exceed the
request.

On approval SpaceBot redirects to `redirect_uri?code=…&state=…`. The code is
single-use and lives for 120 seconds.

### 3. Exchange the code for a key

```http
POST /api/v1/connect/exchange
Content-Type: application/json

{
  "client_id": "starspace-website",
  "client_secret": "sbcs_…",
  "code": "sbc_…",
  "redirect_uri": "https://starspace.group/admin/spacebot/callback"
}
```

```json
{
	"api_key": "sb_live_…",
	"guild_id": "123456789012345678",
	"scopes": ["voice:read", "stats:read"]
}
```

`redirect_uri` must be the one the code was issued against. Every rejection
returns the same message, so probing cannot distinguish an unknown client from a
wrong secret from a spent code.

The key is created **at this step**, not at approval — an approval nobody
redeems leaves no credential behind. It is an ordinary API key from then on, and
is revoked from that server's **API keys** page.

## `GET /api/v1/voice`

Who is in voice right now, from the same live snapshot the dashboard panel
draws.

Requires `voice:read`.

| Parameter      |                                                            |
| -------------- | ---------------------------------------------------------- |
| `channel`      | Filter to one channel, by id or by name (case-insensitive) |
| `include_bots` | `true` to include bots, which are excluded by default      |

A `channel` that matches nothing returns an empty `channels` array rather than a
404: to a caller drawing a panel, "nobody is in there" and "no such channel" are
the same answer, and a 404 would make a quiet evening look like a broken
integration.

```json
{
	"guild_id": "123456789012345678",
	"channels": [
		{
			"channelId": "987654321098765432",
			"channelName": "Ten Forward",
			"memberCount": 3,
			"members": [
				{
					"userId": "…",
					"displayName": "…",
					"avatarUrl": "…",
					"selfMute": false,
					"streaming": true,
					"selfVideo": false,
					"isBot": false
				}
			]
		}
	],
	"totalChannels": 1,
	"totalUsers": 3,
	"updatedAt": "2026-09-06T03:18:30.000Z"
}
```
