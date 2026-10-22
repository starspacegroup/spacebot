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

Timebox (countdown and controls), **Agent** ([game.md](game.md)), the hidden-agent
round, which is played entirely in the Activity: roles, the secret word and
voting are private to each player and shown only here, and Quorum. The nav says
_Agent_ for the game module (id `game`, command `/play`), the name `/start agent`
uses; the dashboard still calls it Game.

## The look (LCARS)

The Activity is drawn as a Star Trek LCARS panel: black ground, condensed
uppercase type, orange, peach, lavender and blue pills and elbows, large text.
The design is the mockup set in the workspace repo,
`design/mockups/activity-lcars-2026-10-16/` (a PNG per screen, and the HTML that
drew it).

- **The frame** (`src/lib/components/activity/LcarsFrame.svelte`): elbows top and
  bottom, the screen's title top right, a footer line bottom right. On a phone the
  elbows go and the nav becomes a row of tabs under the title.
- **The nav**: Timebox / Agent / Quorum. Inactive tabs are dim grey; the active
  one is larger, carries a ▶ and the screen's state colour, and runs into the
  content, so it is always plain which module you are in. _SpaceBot_ is a small
  brand block under the tabs, not a tab.
- **State colour**: one colour per screen, on the elbow, the title and the active
  tab. In the Agent tab: blue for crew, red for the agent, grey when you are out
  (or only watching), orange while the table acts (lobby, vote), lavender for a
  vote's result.
- **The viewer is not in the roster.** Their own badge sits bottom right (avatar,
  name, role or status, vote calls left) in their state colour.
- **Type** is Antonio, self-hosted through `@fontsource/antonio` (OFL), because an
  Activity cannot load Google Fonts: everything it loads has to come through the
  app's own origin. Avatars come from `cdn.discordapp.com`, which Discord allows,
  and fall back to the player's first letter.
- **Styles** are `src/lib/activity/lcars.css`, all scoped under `.lcars`; the
  screen choice, colours and clock sums are pure functions in
  `src/lib/activity/lcars.ts` (tested in `src/tests/activity-lcars.test.ts`).
- **Dev preview** (dev builds only): `/activity?preview=<state>` draws a screen
  with canned data and a _Sample data_ badge. States: `guild` (Timebox), `help`,
  `off`, `dm`, `empty`, `error`, `quorum`, and `game-none`, `game-lobby`,
  `game-crew`, `game-agent`, `game-round`, `game-vote`, `game-ejected`,
  `game-out`, `game-watch`, `game-crew-win`, `game-agent-win`. The e2e checks in
  `e2e/activity-lcars.e2e.ts` run against them.

What the Agent tab shows about other players is only what Discord already shows
everyone in the voice channel (name, avatar, whether they are in the channel and
muted) plus who has a vote in during an open vote. **Speaking is not shown**: the
Activity would need Discord's `rpc.voice.read` scope for the SDK's speaking
events, which Discord grants only on approval, and the gateway bot does not
receive speaking state without joining voice. It is not faked.

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

A big countdown, one bar per focus block (done blocks full, the running
one filling), what comes next, and the deafen choice. `/api/activity/timebox` takes the signed session token (not a cookie) and
a server id, checks the id against the token's list and that Timebox is on there,
and returns only the timeboxes the viewer is part of: their own solo one, the shared
one in the voice channel the Activity was opened in (carried in the token), and the
shared one in the voice channel they are in now. It never returns another member's
ids or deafen choices. The page polls every 15 seconds and counts down locally from
the end time, so a block change shows within a poll of the bot's own minute sweep.
Pause/Resume, Skip and Stop work from the tab: `POST /api/activity/timebox` with `action` and `id`. Allowed for the starter, or anyone in the voice channel when the server sets control to "anyone". Crew use the card in the channel (the Activity does not know a viewer's server permissions).

The tab also lists **other members' solo timers** (name, face, phase, countdown) for people in the same voice channel as the viewer or the one the Activity opened in: the response's `others`. No ids, goals or deafen choices leave the server. Shared timeboxes already show in full. Timebox, game and quorum cards in the channel carry an **Open Activity** button (`activity:open`), answered with a LAUNCH_ACTIVITY response.

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
