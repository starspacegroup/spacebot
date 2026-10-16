# Automation time windows

The **Time of Day / Day of Week** trigger filter lets an automation fire only
when the event happens inside (or outside) a set of time windows. It sits next
to the other trigger filters — channel, role, content — and applies to every
event type. It is not a schedule: the event still starts the automation, and
the windows only decide whether it counts.

```yaml
time_windows:
    mode: include # or exclude — "quiet hours" is the same filter inverted
    timezone: null # null = the server's timezone; or an IANA name
    windows:
        - { days: [tue, thu], start: '19:00', end: '23:00' }
        - { days: [sat, sun], start: '10:00', end: '02:00' } # crosses midnight
```

## Rules

- **Zone.** The window is read in the automation's `timezone`, else the
  server's timezone (Settings), else UTC. A server that never set a timezone
  gets UTC, so set one before relying on a quiet-hours rule. Zones must be
  `Region/City` names (or `UTC`); `EST`, `MST` and `EST5EDT` never follow DST
  and are ignored.
- **DST.** The zone is resolved at evaluation time, so 19:00–23:00 stays
  19:00–23:00 local across both clock changes.
- **Clock.** The event's own `created_at` when it has one, otherwise now.
- **Days.** `days` lists `sun`…`sat`; leave it empty for every day. A window's
  days name the day it _starts_, so a Saturday 22:00–02:00 window still
  matches Sunday 01:00.
- **Midnight.** An `end` before `start` crosses midnight. `start` equal to
  `end` means the whole day. `start` is included, `end` is not.
- **Several windows.** Any one match is enough.
- **Exclude.** `mode: exclude` fires only when no window matches.
- **No filter, no change.** Automations without this filter behave as before.

## Where it lives

- `src/lib/automation/time-windows.ts` — the pure window maths.
- `matchesFilters()` in `src/lib/automation/engine.ts` — the `time_windows`
  case. The caller passes `context.timezone`; both `POST
/api/automations/[guildId]/process` and `processAutomations()` read the
  guild timezone only when some automation uses the filter.
- `TimeWindowsEditor.svelte` — the editor on the new and edit automation pages.
  It submits one JSON string.
- Export/import carries the filter as is. It holds no server ids, so nothing is
  cleared on import (a per-automation `timezone` name is portable too).

## Not included

Cooldowns ("nothing fired in the last hour") and date ranges ("not Dec 24 to
Jan 1") are separate features.
