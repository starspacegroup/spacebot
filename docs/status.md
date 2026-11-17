# Status page

`/status` is the public page for the whole service. `/api/status` is the same data as JSON.
No sign-in. A superadmin posts and updates incidents at `/admin/superadmin/status`.

## What it measures

Only things that are really checked. Each is operational, slow (degraded) or down.

| Component             | How it is checked                                                                | Down when                                                      | Slow when               |
| --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------- |
| Website and dashboard | The orchestrator worker fetches `/_app/version.json` from outside, once a minute | No answer, or an error status                                  | 3 s or more             |
| Database              | `SELECT 1` on D1, timed                                                          | The query fails                                                | 1.5 s or more           |
| Bot host              | The newest `gateway_benchmarks` row (the bot adds one every minute)              | No row for 150 s                                               | never                   |
| Discord connection    | The same row: its status and heartbeat latency                                   | Rows arrive but status is not `connected`, or the host is down | heartbeat 1.5 s or more |

The two bot components tell the cases apart: the host not reporting means the machine or the
process is gone; reports arriving without `connected` means the host is fine and Discord is not.

## How a status changes

A change is shown only after **two checks in a row** agree (`CONFIRM_WORSE`, `CONFIRM_BETTER`
in `src/lib/status/logic.ts`), so one failed probe or a 20-second reconnect never reaches the
page. The bot reconnects to Discord about every two hours and recovers in seconds. A worsening
is dated to its first bad check, a recovery to the check that confirmed it.

## Incidents

- **Opened by the checks.** When a component is confirmed slow or down, an incident opens by
  itself ("Discord connection: the bot is offline"), with a first update that says it came from
  the checks. One per component: a slow site that goes down changes the same incident (minor to
  major) and adds an update instead of opening a second. When the component is confirmed
  operational again the incident is resolved with a note that the checks passed.
- **Posted by a person** at `/admin/superadmin/status`: title, impact (minor, major, critical or
  planned maintenance), stage, which components, and a message. Updates move the stage
  (investigating, identified, monitoring, resolved). Posting is public at once. Plain text only,
  capped at 120 characters for a title and 2,000 for a message.
- Checks never close an incident a person opened, and a person's incident never stops the
  checks from opening their own.

## History

`status_daily` counts checks per component per UTC day by the confirmed status. The page shows
90 days as bars (red after five checks down in a day, amber for any other trouble, grey for no
data) and an uptime figure cut to two decimals, never rounded up, so a day with an outage cannot
read 100.00%. Rows older than 400 days are deleted at 03:00 UTC.

## When the checks stop

If the newest check is older than five minutes, or no check has ever run, the page says
**"Status checks are delayed"** and does not claim all is well. If the data cannot be read, it
says so. `/api/status` answers 503. The page lives on the same Cloudflare Pages app as the rest
of the site, so a full Pages outage takes it down too.

## Moving parts

- `migrations/0100_status_page.sql`: `status_components`, `status_daily`, `status_incidents`,
  `status_incident_updates`.
- `src/lib/status/logic.ts`: the rules, pure.
- `src/lib/db/status.ts`: recording, incidents, the snapshot.
- `POST /api/status/record` (Bearer `CRON_SECRET`): one round of checks. Called by
  `orchestrator-worker` on the `* * * * *` cron (`probeAndRecordStatus`), which also supplies
  the outside view of the website.
- Tests: `status-logic`, `status-db`, `status-api`.

## What it does not do

No email or Discord alerts to subscribers, no per-server status, no check of individual slash
commands or automations. The bot components show whether the bot is connected, not whether every
feature works.
