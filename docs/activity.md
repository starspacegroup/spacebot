---
title: The SpaceBot Activity
layout: default
---

# The SpaceBot Activity

SpaceBot runs inside Discord as an **Activity**: a panel opened from a voice
channel's Activities menu, or from a direct message, that shows live SpaceBot
state to the people in it. It is one Activity with a tab per **module**; the
first module is the timebox. The plan is `planning/ACTIVITY_PLAN.md` in the
workspace repo; Discord's rules are in `research/DISCORD_ACTIVITIES.md`.

## What exists

The foundation: the page, sign-in, the check of where it was opened, and the
module switch. Modules plug in as they ship; a module with nothing to show
keeps its tab and shows a help panel (what it does, how to start it).

## How it is wired

- **Developer Portal** (app id in `DISCORD_CLIENT_ID`): Activities enabled, root
  URL mapping `/` → `spacebot.starspace.group`. The mapping is host-only, because
  a path would break `/_app/...` asset URLs, so `hooks.server.ts` sends the
  iframe's visit to `/` (it carries `frame_id`) on to `/activity` with the same
  query. Enabling Activities created an Entry Point command on the app;
  `registerCommands` keeps it through a global overwrite.
- **Framing.** `/activity` is the one page allowed in an iframe. It drops
  `X-Frame-Options` and enforces `frame-ancestors` for Discord's origins
  (`security-headers.ts`). Every other page is unchanged.
- **Sign-in**, `src/lib/server/activity.ts` with `/api/activity/token` and
  `/api/activity/session`:
    1. the SDK's `authorize` gives a `code`; the server trades it for the viewer's
       token (the client secret stays on the server);
    2. the server asks Discord who the viewer is, and asks Discord (bot token,
       `get_activity_instance`) where the Activity was opened and who is in it;
    3. it returns a signed token (5 minutes, HMAC keyed from the client secret)
       and the servers and modules the viewer may use.
       Nothing the page says about itself is believed. There is no cookie: the
       Activity is a third-party iframe, so the token is held in memory.
- **Where it may run.** A guild voice channel (the viewer must be a current
  member of that guild), or a DM. In a DM there is no guild, so the viewer sees
  the servers they belong to that have a module on. A **group DM** works only
  for a server whose member list includes everyone connected to the instance; if
  someone who is not a member joins, the page shows no server data until they
  leave. The page asks again whenever the participant list changes.
- **Modules** are listed in `ACTIVITY_MODULES`. Each is gated by a built-in
  command, so a server turns it on the way it turns the command on
  (`built_in_command_overrides`).

## Modules

Timebox (read-only countdown) and **Game** ([game.md](game.md)), the hidden-agent
round, which is played entirely in the Activity: roles, the secret word and
voting are private to each player and shown only here.

## Turning it on (the dashboard)

Server dashboard → **Activity** (`/admin/<server>/activity`, full admin only).
It holds one switch per Activity part (Timebox and Game), the Timebox defaults,
and the Game settings (role names, players, round and vote lengths, the mute). A part's switch is the same per-server override as its slash command,
so turning Timebox off also hides `/timebox` from members, and turning it on
pushes the command to Discord at once. The defaults (focus, break, long break,
rounds, who may pause or stop) are the ones `/timebox settings` writes; both use
the same limits. Who may run `/timebox`, including by role, is on the Slash
Commands page ([command access](command-access.md)).

## The Timebox tab

Read-only. `/api/activity/timebox` takes the signed session token (not a cookie) and
a server id, checks the id against the token's list and that Timebox is on there,
and returns only the timeboxes the viewer is part of: their own solo one, the shared
one in the voice channel the Activity was opened in (carried in the token), and the
shared one in the voice channel they are in now. It never returns another member's
ids or deafen choices. The page polls every 15 seconds and counts down locally from
the end time, so a block change shows within a poll of the bot's own minute sweep.
Controls stay on the card in the channel for now.

## Not yet

Controls in the Timebox tab and other modules' views, push updates (the page refreshes on a
timer and on participant changes), Discovery (the App Launcher listing), and the
User Install setting that Discord may require for launching in a DM. Developer
Portal checks still open: whether the Activity needs its own verification beyond
the bot's, and the participant cap.

## `/start`

One command starts any of these, and it lists only what the server has turned on:

- `/start timebox` takes the options of `/timebox start`.
- `/start agent` opens a Game lobby (`/play start`).
- `/start quorum` takes the options of `/quorum ask`.

`/start` has no row of its own. `src/lib/discord/start-command.ts` builds it for each
server from the commands that server has on, so its options never drift from the
originals. The interaction is turned back into the original command before the
permission check, so command access rules still apply to `/timebox`, `/play` and
`/quorum`. The old commands stay as shortcuts. Stop and status stay on those
commands, on the cards' buttons and in the Activity.

## Quorum in the Activity

The Quorum tab shows the server's open yes/no questions, lets a member vote on
each, and has a box to ask one. It is the same Quorum as `/quorum`: a vote from the
Activity and a vote from the card in the channel are the same vote, and the card is
edited to match. Switching Quorum off on the dashboard's Activity page switches off
`/quorum` too.

- **Who sees what.** A question lives in a text channel, and a channel can be
  private. A question shows, and takes a vote, only for a member who can see its
  channel (`src/lib/server/channel-access.ts` works it out from the server's roles,
  the member's roles and the channel's overwrites). If Discord won't say, the answer
  is "can't see". A member sees only their own vote.
- **Asking.** A question goes to the chat of the voice channel the Activity is open in.
  It uses that channel's Quorum defaults. It is a plain `general` question, owned by
  the asker. Owner-only classes, owners, due dates, quorum and automatic actions stay
  on `/quorum ask`. If the bot can't post the card, the question is taken back.
- **Not in the tab.** Closing early, vetoing and follow-ups stay on the card and
  `/quorum`.

API: `POST /api/activity/quorum`. Code: `src/lib/server/activity-quorum.ts`,
`src/lib/components/QuorumTab.svelte`.
