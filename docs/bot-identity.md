# Bot name and image per server

A server owner (Manage Server) can have the bot use its own name and picture on that server only:
Settings → Bot name and image. Off by default.

- **Name:** a custom name (up to 32 characters), or by default `<server name>Bot` (the server name is
  cut so the whole name fits Discord's 32).
- **Image:** the server's icon by default (follows it when the icon changes), or a picture the owner
  uploads (PNG, JPEG, GIF or WebP, up to 256 KB; the type is read from the bytes, not the file name).
- **Turning it off** gives the bot back its own name and picture on that server.

It uses Discord's _Modify Current Member_ (`PATCH /guilds/{id}/members/@me`) with `nick` and `avatar`.
The bot needs **Change Nickname** on the server; when Discord refuses, the page shows why and offers
"Try again". Avatar changes are rate limited by Discord.

Stored in `guild_bot_identity` (migration 0108). The uploaded picture is kept in the row as a data URI
so it can be re-applied. The gateway calls `POST /api/gateway/bot-identity/:guildId` (bot-token auth)
when a server's name or icon changes; the call re-applies only when what Discord holds would change.
The rules (names, icon URL, image check, the request body) are pure in
`src/lib/server/bot-identity-core.ts`; the apply step is `src/lib/db/bot-identity.ts`.

Not done: a custom banner or bio (Discord allows both); applying when the bot joins a server that
already has the option on (it applies on the next save or the next name/icon change).
