# Observances — a historical day, posted as it happened

A server owner can turn on a **timeline**: the events of a historical day,
posted one at a time as their minutes come round on the anniversary. 8:46 AM
arrives at 8:46 AM.

One timeline ships: **September 11, 2001**.

Admin → your server → **Observances** (`/admin/<serverId>/observances`).

## Why it works this way

A block of text nobody reads to the end is the normal way a bot marks a date.
Spreading the same record across the day it describes is the point of this
feature — the pace is the content.

**Off for every guild, always, until somebody turns it on.** There is no
enable-for-all switch and there is no default channel. A commemoration belongs
to the server that holds it; a platform scheduling one on its members' behalf is
a different and much worse product.

## Settings

| Setting                   | Default            | What it does                                              |
| ------------------------- | ------------------ | --------------------------------------------------------- |
| Channel                   | —                  | Where the events post. Required before it can be enabled. |
| Read the times against    | `America/New_York` | Which clock `08:46` means.                                |
| Post up to (minutes late) | 15                 | How stale an event may be and still go out.               |
| Post as embeds            | on                 | Embeds, or plain text for servers that strip them.        |

**The timezone is a real choice, not a formality.** The default is the zone the
events happened in, so the times mean what they mean in the record. A server
whose members are all in Sydney may prefer the day to land on their own clocks
instead. Both readings are defensible; neither is assumed.

**The grace window is what stops a burst.** The dispatcher ticks once a minute,
and ticks get missed — a deploy, a queue backlog, an incident upstream. Without
a bound, an outage from 9 AM to noon would empty three hours of a memorial into
the channel at once, in the wrong order relative to the day. Past the window an
event is recorded as `skipped` instead. A gap is quiet. A dump is not.

## What a post contains

Each post is one event, and it is meant to be legible to somebody who scrolled
into the channel without context:

- **The time and the title** — `8:46 AM — The North Tower is struck`.
- **The body**, written to stand alone. These arrive hours apart.
- **A map link** to where it happened, where there is a single place. The link
  is the documented Google Maps URL API, built from either a coordinate or a
  place name — a named search that lands on the right building beats a
  coordinate invented to three decimals.
- **A photograph**, where a properly-licensed one of that moment exists.
- **A footer naming the day**, on every post rather than only the first, plus
  the photo credit.

Events with no single place get no pin — an aircraft in the air, an order that
applied to the whole country. Events with no properly-licensed photograph get no
image. **An empty frame is better than a stock photograph standing in for a
death**, and a pin invented for a location nobody can verify is worse than none.

### Where the photographs come from

Every image is a public-domain or Creative-Commons file on Wikimedia Commons —
FEMA, the Navy, the Air Force, the National Park Service, Customs and Border
Protection, White House photographers, and a few CC-licensed contributions.
Attribution rides in the embed footer because those licences require it.

**Check what a file actually shows, not what its filename suggests.** Read the
Commons description and the date before you use one. Four of the first set
picked here were wrong: a dust cloud captioned WTC2 sat under the North Tower's
collapse, and two FEMA photographs taken on 14 and 16 September — one of them
the President meeting rescue teams — sat under events from the morning of the
11th. A caption is evidence. A filename is not.

**The famous press photographs of that morning are not used.** Almost all of
them are still under copyright to AP, Reuters and Getty, and a memorial is a bad
place to be casual about somebody else's work. If you add a timeline, hold its
images to the same line.

In plain-text mode there is no embed frame, so the map and the photograph are
spelled out as URLs wrapped in `<>`. Discord renders a masked `[text](url)` link
**inside an embed only** — in ordinary message content it posts the brackets
literally — and the angle brackets are what suppress the auto-preview a guild
turned embeds off to avoid.

## How it runs

Exactly like the other minute-cadence jobs:

```
orchestrator-worker cron (* * * * *)
  → POST /api/superadmin/workflows/dispatch
    → preset `minute-anniversary-timeline`
      → operation `postAnniversaryTimelines`
        → processAnniversaryTimelines(db, botToken)   [src/lib/db/anniversary-timeline.ts]
```

The preset is auto-seeded by slug on the dispatch tick, so a deploy is all the
setup there is. It is also exposed as the manual job
`post_anniversary_timelines` under Admin → Superadmin → Cron.

On 364 days a year a tick costs one indexed read of enabled rows and a date
comparison.

## Posting exactly once

The unique index `(timeline_id, year, event_key)` on
`anniversary_timeline_posts` is the lock, not a report. Each event is claimed
with `INSERT OR IGNORE` and only posted if the insert actually changed a row —
so when two ticks overlap, or a Workflow step retries, SQLite decides the winner
rather than timing does.

A send that fails is marked `failed` and **is not retried**. On this of all
days, a duplicate is worse than a gap: the failure usually means the bot cannot
post in that channel, and retrying every minute would either do nothing or,
worse, succeed twice.

A row stuck at `claimed` means the process died between claiming and posting.
It is left alone for the same reason.

## Content

`src/lib/anniversaries.ts`. Deliberately in code, not in the database:

- Every guild gets the same record. A per-server editable copy is a way for one
  to quietly drift wrong with nobody to notice.
- Changing what happened should be a commit with a diff and a reviewer.

Event `key`s are permanent — they are the idempotency key. Renaming one re-posts
an event that already went out.

The September 11 timeline follows the 9/11 Commission Report where a commonly
quoted time and the Commission's differ. Times are the seismically- and
radar-confirmed ones, truncated to the minute. The register is plain
declaratives: it is read by people who remember the day and by people born after
it, and the second group is now most of them.

## Adding a timeline

1. Add an `AnniversaryTimeline` to `ANNIVERSARY_TIMELINES` in
   `src/lib/anniversaries.ts`: a `key`, `month`/`day`, `sourceYear`, the zone it
   is recorded in, and events in time order with exactly one `opening` and one
   `closing`.
2. Nothing else. The schema already carries `timeline_key`, the dashboard reads
   the registry, and the tests assert ordering, unique keys and the
   opening/closing invariant across every registered timeline.

Sourcing is the work, not the plumbing. A timeline that is nearly right is worse
than no timeline, because it will be read as authoritative and nobody checks.
