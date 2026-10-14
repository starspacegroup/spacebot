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

## Not yet

Module views and the controls on them, push updates (the page refreshes on a
timer and on participant changes), Discovery (the App Launcher listing), and the
User Install setting that Discord may require for launching in a DM. Developer
Portal checks still open: whether the Activity needs its own verification beyond
the bot's, and the participant cap.
