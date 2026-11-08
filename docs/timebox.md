---
title: Timebox
layout: default
---

# Timebox

`/timebox` runs focus blocks and breaks, alone or for everyone in a voice
channel. The default is one block of 23 minutes of focus and then it is done. Ask for
more `rounds` and it adds a 5-minute break after each block, and a 15-minute break after
every fourth. All of it is an option on the
command and a per-server default. The plan and its reasoning are in the workspace
repo's `planning/IDEAS.md` ("Timebox").

The name is deliberate: _timebox_, _focus block_ and _break_. The name of one
well-known technique is a trademark, so the command and its copy avoid it.

## Turning it on

It is **off by default**. A server admin enables it from the dashboard, which
writes a row to `built_in_command_overrides`; until then Discord does not list
the command in that server, and the handler refuses it anyway.

## Using it

- `/timebox start` — with options `focus`, `break`, `long_break`, `rounds`,
  `deafen`, and `solo`.
    - **Shared.** Used while you are in a voice channel: one public card for the
      channel with Pause, Skip, Stop and **Deafen me** buttons. The person who started
      it and everyone who took part (set a goal or a deafen mode) is pinged at each
      change; others in the channel are not. One shared timebox per voice channel; a
      second `/timebox start` there points at the running card.
    - **Solo.** Used outside voice, or with `solo:True`. Your card is private, and
      each change is a fresh message in the channel pinging you, with the buttons.
      One at a time per member.
- `/timebox stop`, `/timebox status` — for the timebox you are part of.
- `/timebox goal text:...` — set or change your goal while a timebox runs.
- `/timebox progress percent:...` — say how much of your goal you got done (0 to
  100). It works after the timebox ended, against the last one you had a goal in.
- `/timebox settings` (Crew) — the server defaults, and who may pause, skip and
  stop a shared timebox: the starter and Crew (default), or anyone in the voice
  channel. Crew means Manage Server, Manage Channels or Administrator.

A shared timebox ends by itself if its voice channel stays empty for 5 minutes.

## Goals

Say what you want to get done with the `goal` option on `/timebox start`, or later
with `/timebox goal`. The goal (200 characters, one line) shows on the card. When
the timebox ends, whether it finished or was stopped, the card swaps its controls
for **0 / 25 / 50 / 75 / 100 %** buttons, and the ping asks how it went. Pressing
one records that percent against your goal; `/timebox progress` records any
whole number. Changing a goal clears its percent.

Goals are per member: in a shared timebox each person has their own, shown as
`@name: goal — 75%` (the first 8). Someone who set no goal has nothing to rate. They
live on `timebox_participants` (`goal`, `percent_done`, migration 0071).

## Deafen me

A member's own choice for themselves: _during each focus block_ or _until the
whole timebox ends_. It is applied as a server-deafen **and** a server-mute, so
the member neither hears nor is heard.

- **The member can always end it.** Discord does not let a member lift their own
  server-deafen, so the **Deafen me** button toggles it off, and Stop and the
  sweep lift it too. Pausing lifts it; resuming brings it back.
- **Restore, do not clear.** The bot records whether the member was already
  deafened and whether they were already muted (`prev_deaf`, `prev_mute`, migration 0080) and puts back exactly that. A member a moderator deafened or muted stays
  that way.
- **The focus role.** The bot marks its own hold with a role, **Timebox focus**
  (migration 0097). It makes the role the first time it holds someone in a server (no
  permissions, not shown apart, not mentionable), remembers it in
  `timebox_settings.focus_role_id`, adds it when it deafens or mutes a member, and
  removes it when it lifts. This is so the bot and a server's own automations do not
  step on each other. An automation can keep its own role for its own holds. The bot
  lifts a member's deafen and mute only while its role is still on them: if the role
  was taken off (an automation or a moderator took over), it leaves their voice state
  alone and drops the hold. An automation can also read the role, for example to skip
  members who are in a timebox. The bot needs **Manage Roles**, and its own role must
  sit above Timebox focus. Without Manage Roles it still works as before, from the
  ledger alone (`role_added` stays 0). If the server deletes the role, the bot makes a
  new one on the next hold.
- **Places the server holds.** If an automation of the server keeps everyone muted
  and deafened in a voice channel, an admin names that channel (and, if the
  automation uses one, its role) under Activity, Timebox, "Places the server holds"
  (`timebox_settings.no_lift_channels` and `no_lift_roles`, migration 0097). Then:
    - The timebox never lifts a member's deafen or mute while they are in one of
      those channels or have one of those roles, even if they asked for the timebox
      deafen. Where they are is asked of Discord at the moment of the lift, not read
      from the live table, which can be a few seconds stale.
    - It does not start a hold there either: it says the server already holds them.
    - Nothing is forgotten. A lift that was skipped stays pending, and runs when the
      member leaves that place: the join or move event settles it at once, and the
      minute sweep retries for a day.
    - **Leaving voice mid-session:** the hold and the goal stay. A lift that cannot run
      while they are out waits and runs on their next join. When they come back to a live
      timebox, the bot checks that Discord kept the deafen and mute and sets them again
      if it dropped them (not in a server-held place, and not if the focus role was
      taken off).
    - **Switching channels mid-session:** the hold is the member's, not the channel's,
      so it follows them. They can still press **Deafen me** to lift it from any channel.
      A move out of a server-held channel runs a pending lift.
    - A lift that failed during a break is dropped once the next focus block has begun,
      so it cannot undo that block's deafen.
- **Discord's limits.** The bot needs Deafen Members and Mute Members and a role above the member;
  it cannot change the server owner. It can only change a member who is in a
  voice channel. A member who is not yet in one is deafened within a minute of
  joining; if the bot cannot lift a deafen because the member left voice, the
  sweep keeps trying, and gives up a day after the timebox ended. **Not yet
  verified against a live server:** how Discord treats a member who disconnects
  while server-deafened.

## How it runs

State is in D1 (`timebox_sessions`, `timebox_participants`, `timebox_settings`,
migration 0070). The countdown on a card is Discord's own `<t:unix:R>`, so
nothing edits a card per second. The **minute sweep** (`sweep_timebox`, a
workflow preset beside the room reaper) moves a session on once its
end time has passed, so a change can land up to a minute late. Each block ends
where the schedule said it would, not when the sweep noticed, so lateness does not
add up, and after an outage the sweep announces only where the session landed.
While anyone has the Activity open, its poll also settles a block that has run out at once (`hasOverdue`, then the same sweep), so the deafen lifts when the timer hits zero.
With nothing live and nothing pending the sweep is two indexed reads.

The plan preferred a timer in the gateway process for exact changes. The minute
sweep was used instead because it needs no new moving part and matches the other
timed features; a gateway timer can replace it later without changing the data.

## Not yet

A voice channel made for the timebox (access, who may talk or share a screen,
delete-or-alert at the end), muting everyone during focus, controls on the Timebox tab in the
Activity (it shows the countdown with pause, skip and stop, see `docs/activity.md`; it shows your own goal; the percent done is not shown there yet), a chime at each change, a completed-blocks
stat, and a history of goals and percents.
