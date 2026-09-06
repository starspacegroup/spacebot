---
title: Member Rooms
layout: default
---

# Member Rooms

Member rooms let ordinary members create and run their own Discord channels —
text or voice — that clean themselves up afterwards. A server admin defines a
**preset**; members create rooms from it, and each creator manages only their
own room.

> `/room create name:Study Session` → a voice channel appears, its creator can
> rename it, lock it, invite people, and it disappears 15 minutes after the last
> person leaves.

## The two entry points

**`/room`** is a built-in command family. A guild enables it like any other
built-in command; per-guild enable/disable and the Discord permission gate come
from `built_in_command_overrides`. Its subcommands are `create`, `rename`,
`invite`, `kick`, `lock`, `unlock`, `limit`, `transfer`, `extend` and `delete`.

**A join-to-create lobby** needs no command. Set `lobby_channel_id` on a preset
and joining that voice channel makes the member a room and moves them into it.
The gateway holds no database, so it asks the app
(`POST /api/rooms/{guildId}/lobby`), which decides and creates; the gateway only
performs the move. Each reply carries the guild's lobby channel ids, which the
gateway caches for five minutes — otherwise every voice join in every guild
would cost a database read.

## Presets

Presets live in `channel_presets` and are edited under **Server → Member
Rooms**. One guild can have several. The preset is read at run time, not frozen
at creation, so changing it governs rooms that already exist.

| Field                                            | What it does                                           |
| ------------------------------------------------ | ------------------------------------------------------ |
| `channel_type`                                   | `2` for voice, `0` for text                            |
| `parent_id`                                      | Category the room is created under                     |
| `name_pattern`                                   | Supports template variables, e.g. `{user.name}'s room` |
| `lobby_channel_id`                               | Join-to-create trigger channel (voice only)            |
| `allow_role_ids` / `deny_role_ids`               | Who may create a room                                  |
| `lifetime_mode`                                  | `idle`, `fixed` or `manual`                            |
| `ttl_minutes` / `idle_minutes` / `grace_minutes` | The clocks                                             |
| `extend_minutes` / `max_extensions`              | What `/room extend` buys                               |
| `max_per_user` / `max_per_guild` / `max_renames` | Caps                                                   |
| `owner_can`                                      | Verbs delegated to the creator                         |
| `owner_allow` / `everyone_deny`                  | Permission overwrites applied at creation              |

### Why it is not called a template

`commands.source_template_key` already means _integration command template_,
which is cloned into a guild with no live link — editing the template never
touches the command. A preset is the opposite: it is a live policy the verbs and
the reaper read every time. Two words, two meanings, deliberately kept apart.

## Who may create a room

Two gates, and both must pass:

1. **The command's own permission gate.** `/room` carries whatever
   `default_member_permissions` the guild sets on it.
2. **The preset's role lists.** An empty `allow_role_ids` means "anyone who got
   past the first gate". A role in `deny_role_ids` always loses.

The second gate exists because Discord's per-command role permissions cannot be
set with a bot token — that endpoint needs a user Bearer token with Manage
Guild — so role-level control has to be enforced in our own code.

## What the creator can do

Only the verbs in `owner_can`, and only against their own room. Every verb
resolves the caller's room out of `managed_channels` rather than trusting a
channel id from the interaction, so `/room kick` cannot reach a channel the
caller does not own. A member with **Manage Channels** can run any verb on any
room in the guild.

**The creator is never granted `MANAGE_CHANNELS` on their room.** It is the
tempting shortcut for rename and user-limit, and it hands the member powers
`owner_can` cannot take back: editing the channel's permissions freely, and
deleting the channel out from under its ownership row. The permission is
stripped server-side even if the preset form is tampered with. Every verb runs
through the bot instead.

## Lifetimes

- **`idle`** — a voice room closes once it has been empty for `idle_minutes`.
  Occupancy is counted from `live_voice_states`, excluding bots, so a music bot
  alone in an abandoned room does not keep it alive.
- **`fixed`** — the room closes `ttl_minutes` after it was created, whether or
  not anyone is in it.
- **`manual`** — the room never closes on its own.

A text room has no occupancy to measure, so `idle` falls back to the fixed TTL
rather than inventing a "last message" scan.

`grace_minutes` protects a brand new room: it is never reaped inside that
window, so a room cannot vanish between being created and its creator finishing
the voice handshake.

## The reaper

`reap_managed_channels` runs every minute as a superadmin workflow, beside
scheduled message dispatch. It is written to cost nothing when nothing is open:

1. Read active rows from `managed_channels`. **No rooms means the tick ends
   here** — one indexed read.
2. Read human occupancy for the voice rooms among them, in one query.
3. Record transitions: a room seen empty for the first time gets
   `empty_since`; a room somebody rejoined has it cleared.
4. Delete what is due, then close the row. A `404` means somebody deleted the
   channel by hand — that is a success, and the row still closes.

Idle is **edge-recorded**, not measured backwards: the countdown starts from
the first scan that saw the room empty. That makes the interval predictable
regardless of when the last person actually left.

`Events.ChannelDelete` also reports to `POST /api/rooms/{guildId}/channel-deleted`,
so a hand-deleted room stops counting against its owner's cap immediately
rather than at the next scan.

## Discord limits worth knowing

- **Renames are throttled to 2 per 10 minutes per channel.** The REST client
  would sit on the 429 until the interaction expired, so `max_renames` refuses
  with an explanation instead.
- **A guild caps at 500 channels, a category at 50 children.** `max_per_guild`
  is what keeps rooms from walking into that wall; past it, room creation
  reports the server is out of channel slots.
- **A bot cannot grant permissions it does not hold.** The default invite is
  Administrator, but a guild that installed SpaceBot with a narrower bitfield
  will see room creation fail with a permissions message.
- **`user_limit` is 0–99**, where 0 means unlimited.

## Where the code is

| Piece                   | File                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| Policy (pure decisions) | `src/lib/discord/managed-channel-policy.ts`                                       |
| Room operations         | `src/lib/automation/managed-channels.ts`                                          |
| Tables                  | `src/lib/db/managed-channels.ts`, `migrations/0060_managed_channels.sql`          |
| `/room` command         | `migrations/0061_room_built_in_command.sql`                                       |
| Action types            | `CREATE_MANAGED_CHANNEL`, `MANAGE_MANAGED_CHANNEL` in `src/lib/db/automations.ts` |
| Reaper                  | `src/lib/server/managed-channel-reaper.ts`                                        |
| Lobby + reconciliation  | `src/routes/api/rooms/[guildId]/`, `src/lib/discord/gateway.ts`                   |
| Dashboard               | `src/routes/admin/[serverId]/rooms/`                                              |
