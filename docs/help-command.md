---
title: The /help command
layout: default
---

# The `/help` command

`/help` answers one question: **what can I run here?**

It is built per member, from the server's real command set, filtered to what
that member's permissions actually allow, and replied ephemerally. A moderator
and an ordinary member asking the same question get different answers, and
neither is shown something they would be refused.

## Every server has it

`/help` is in `ALWAYS_ENABLED_BUILT_INS` (`src/lib/db/commands.ts`). A guild can
change its permission gate like any other built-in, but it cannot turn it off:

- `setBuiltInCommandOverride` refuses `enabled: false` for it, so the dashboard
  can say why rather than showing a toggle that springs back.
- `applyBuiltInOverride` forces `enabled` true when reading, so an override
  written before this rule existed has no effect.
- The dashboard shows an **Always on** badge in place of the toggle.

"Always available" also means _registered_. A guild's command set only ever
reached Discord on a command write, so a freshly invited bot had no commands at
all until an admin saved one. `Events.GuildCreate` now calls
`POST /api/guilds/{guildId}/sync-commands` — bot-token authenticated, like the
room lobby — so joining a server registers its commands immediately. That
handler ignores the GuildCreate burst that arrives while the gateway is
starting up, which is not a join; those all land before the client is ready.

## What gets listed

`collectGuildCommands` (`src/lib/discord/commands.ts`) is the single source for
both `/help` and `syncGuildCommands`. Registering and listing read the same
set on purpose — the alternative is a command that exists in Discord and not in
the help, or the reverse.

| Source        | Where it comes from                                           |
| ------------- | ------------------------------------------------------------- |
| `built-in`    | `commands` rows under `__built_in__`, guild overrides applied |
| `server`      | The guild's own enabled commands                              |
| `integration` | Commands from the guild's enabled integrations                |

A command family is listed with its subcommands underneath, so `/room` shows
`/room create`, `/room lock` and the rest rather than one opaque line.

## Filtering

`memberHasCommandPermission` decides, the same function the interaction
dispatcher uses to gate the command itself. That matters: Discord's own
`default_member_permissions` gate is advisory, and this is the one that decides
whether the command would actually run.

It **fails closed**. A restricted command whose caller's permissions cannot be
read is left out — a DM has no member, and guessing "allowed" would advertise
moderator commands to everyone.

Filtering stops at the command gate. `/room` has role lists of its own in its
preset, and a member whose roles that preset denies still sees `/room` here;
the command is available to them, and it explains itself when they run it.

## Limits

Discord caps an embed at 25 fields and a field value at 1024 characters. A
server with more commands than that gets the overflow named in a final field
rather than silently cut — a member who cannot see a command in help concludes
it does not exist.

## In DMs

A DM has no guild and no member, so `/help` lists the built-ins whose
`dm_permission` lets Discord deliver them there.

## Where the code is

| Piece                | File                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Listing and embed    | `src/lib/discord/help.ts`                                                                              |
| Shared command set   | `collectGuildCommands` in `src/lib/discord/commands.ts`                                                |
| Always-on rule       | `ALWAYS_ENABLED_BUILT_INS` in `src/lib/db/commands.ts`                                                 |
| Interaction handling | `src/routes/api/discord/interactions/+server.ts`                                                       |
| Join registration    | `src/routes/api/guilds/[guildId]/sync-commands/`, `Events.GuildCreate` in `src/lib/discord/gateway.ts` |
| Stored row           | `migrations/0066_help_command_dynamic.sql`                                                             |
