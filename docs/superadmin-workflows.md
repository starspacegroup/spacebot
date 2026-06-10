# Superadmin Workflows

The superadmin workflow system replaces the hardcoded gateway cron jobs with
D1-defined workflow templates that are editable in the canvas UI
(Admin → Superadmin → Workflows), scheduled with real cron expressions, and
executed step-by-step with full run/step history.

## Architecture

```
scripts/cron.js (PM2, dumb 30s tick)
   └─ POST /api/superadmin/workflows/dispatch   (Bearer CRON_SECRET)
        ├─ seeds presets when the DB has no templates (first-run continuity)
        ├─ matches enabled templates' cron_expression against the current UTC minute
        ├─ dedupes per template per minute
        └─ executes due runs via the graph runtime (waitUntil — tick returns fast)

Manual runs: POST /api/superadmin/workflows/:id/runs  (superadmin session)
Both paths share $lib/server/superadmin-workflow-runtime.js.
```

- **`src/lib/server/cron-jobs.js`** — the actual job implementations
  (aggregation, daily refresh, cache refresh, rebuild). Shared by the legacy
  `/api/cron` endpoint and workflow operations, so behavior is identical.
- **`src/lib/server/superadmin-workflow-operations.js`** — the operation
  registry. A task node's `data.operation` selects one of these.
- **`src/lib/server/superadmin-workflow-runtime.js`** — walks the canvas graph
  (trigger / task / branch / approval), executes operations, runs custom
  actions, records step status/output, and routes edges by branch results.
- **`src/lib/server/superadmin-workflow-presets.js`** — built-in templates
  mirroring the legacy cron jobs 1:1, plus a local-runner example.
- **`src/lib/server/cron-match.js`** — 5-field cron matcher (UTC, minute
  granularity; `*`, `*/n`, lists, ranges, dom/dow OR semantics).

## Registered operations

`GET /api/superadmin/workflows/dispatch` returns the live catalog. Highlights:

| Operation | What it does |
| --- | --- |
| `runStatsAggregation` | Hourly+daily aggregation for all active guilds |
| `fetchGuildStatsFromDiscord` | Server stats + metadata refresh for all bot guilds |
| `refreshGuildCache` | Member/role cache refresh for all bot guilds |
| `cleanupOldData` | Prune old stats + cleanup expired operational data |
| `claimScheduledMessages` / `processScheduledMessages` | Scheduled message delivery |
| `syncWorkersAICatalog` | Workers AI model catalog refresh |
| `sweepAllTimedOutRunnerJobs` | Runner job timeout hygiene |
| `deleteAggregatedStats` / `runRebuildStats` / `verifyAggregateIntegrity` | Recovery path (destructive ops flagged) |
| `local_runner_job` | Dispatch a job to a local runner and optionally wait for the result |
| `http_request` | Generic HTTP call with `{token}` templating |
| `legacy_cron_job` | Per-step bridge to a named `/api/cron` job |
| `sleep`, `noop` | Structural helpers |

### Talking to a local runner

Task node data for `local_runner_job`:

```json
{
  "operation": "local_runner_job",
  "runner_token_id": 3,
  "job_type": "shell_command",
  "command": "uptime",
  "wait_for_result": true,
  "wait_timeout_seconds": 60,
  "fail_on_timeout": false
}
```

Any runner job type works (`shell_command`, `system_profile`, `dm`,
`screenshot_capture`, `vscode_*`, …) — set `payload` for typed jobs. The
result (`status`, `output`, `exit_code`, `result`) lands in the step output
and in `{steps.<nodeId>.…}` variables for downstream nodes. The seeded
**Local Runner Health Check** template (disabled by default) is a working
example — set `runner_token_id` on its nodes and enable it.

### Variables and templating

String values in node data, branch operands, and custom actions support
`{token}` templating: `{input.x}`, `{variables.x}`, `{steps.<nodeId>.count}`,
`{run.id}`, `{now}`. Operations may also publish convenience variables
(`guilds_found`, `messages_found`).

## Migrating off the legacy cron system

1. Deploy. `scripts/cron.js` (PM2 `spacebot-cron`) now only ticks the
   dispatcher — schedules live on workflow templates.
2. On the first dispatch with an empty `superadmin_workflow_templates` table,
   the presets are seeded automatically (hourly rollup, daily refresh, minute
   message dispatch, 6-hour AI catalog sync — same cadence as before).
3. `/api/cron` still exists for manual job triggers and the superadmin cron
   page; node-less templates with `legacy_job_name` bridge to it. Everything
   seeded executes natively through the graph runtime.

Requires `CRON_SECRET` (or `INTERNAL_API_KEY`) to be set both for the Pages
app and the gateway host so the tick can authenticate.
