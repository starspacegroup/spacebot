---
title: Timebox
layout: default
---

# Timebox

`/timebox` runs focus blocks and breaks, alone or for everyone in a voice
channel. The default is 23 minutes of focus, a 5-minute break, and a 15-minute
break after every fourth block, for 4 blocks. All of it is an option on the
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
      channel with Pause, Skip, Stop and **Deafen me** buttons. Everyone in the
      channel is pinged at each change. One shared timebox per voice channel; a
      second `/timebox start` there points at the running card.
    - **Solo.** Used outside voice, or with `solo:True`. Your card is private, and
      each change is a fresh message in the channel pinging you, with the buttons.
      One at a time per member.
- `/timebox stop`, `/timebox status` — for the timebox you are part of.
- `/timebox settings` (Crew) — the server defaults, and who may pause, skip and
  stop a shared timebox: the starter and Crew (default), or anyone in the voice
  channel. Crew means Manage Server, Manage Channels or Administrator.

A shared timebox ends by itself if its voice channel stays empty for 5 minutes.

## Deafen me

A member's own choice for themselves: _during each focus block_ or _until the
whole timebox ends_. It is applied as a server-deafen.

- **The member can always end it.** Discord does not let a member lift their own
  server-deafen, so the **Deafen me** button toggles it off, and Stop and the
  sweep lift it too. Pausing lifts it; resuming brings it back.
- **Restore, do not clear.** The bot records whether the member was already
  deafened and puts back exactly that. A member a moderator deafened stays
  deafened.
- **Discord's limits.** The bot needs Deafen Members and a role above the member;
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
With nothing live and nothing pending the sweep is two indexed reads.

The plan preferred a timer in the gateway process for exact changes. The minute
sweep was used instead because it needs no new moving part and matches the other
timed features; a gateway timer can replace it later without changing the data.

## Not yet

A voice channel made for the timebox (access, who may talk or share a screen,
delete-or-alert at the end), muting everyone during focus, the Timebox tab in the
Activity (`docs/activity.md`), a chime at each change, and a completed-blocks
stat.
