---
title: Superadmin Workflows
layout: default
---

# Superadmin Workflows

The superadmin workflow system replaces the hardcoded gateway cron jobs with
D1-defined workflow templates that are editable in the builder UI
(Admin → Superadmin → Workflows), scheduled with real cron expressions,
executed **durably on Cloudflare Workflows + Queues**, and fully
**version-controlled** — every definition change is snapshotted and any
workflow can be reverted to any past version.

## Architecture

```
orchestrator-worker (Cloudflare Worker)
  Cron Trigger "* * * * *"
   └─ CronDispatchWorkflow (durable step)
        └─ POST /api/superadmin/workflows/dispatch   (Bearer CRON_SECRET)
             ├─ tops up missing built-in presets (matched by slug, every tick)
             ├─ matches enabled templates' cron_expression against the current UTC minute
             ├─ dedupes per template per minute
             ├─ creates due runs (status: queued) and enqueues
             │    {type:"superadmin_run_start", runId} → spacebot-workflow-runs queue
             └─ watchdog: re-enqueues stale queued runs; inline-resumes runs
                whose Workflow instance died (overdue sleeps/approvals/deadline)

  spacebot-workflow-runs queue consumer
   ├─ superadmin_run_start    → SUPERADMIN_RUN_WORKFLOW.create({id: "sa-run-<runId>"})
   └─ superadmin_run_approval → instance.sendEvent({type:"approval"})   (wake-up only)

  SuperadminRunWorkflow (one durable instance per run)
   └─ loop: step.do(POST /api/superadmin/workflows/runs/:id/advance)
        ├─ wait.sleep     → step.sleep (timed tasks, retry backoff)
        ├─ wait.approval  → step.waitForEvent("approval", timeout)
        └─ done           → exit
```

All graph semantics live in the Pages app
(`src/lib/server/superadmin-workflow-advance.ts`): the **advance endpoint
executes at most one node per call**, persists loop state in the run's
`state_json`, and is idempotent — the Workflow instance is a dumb durable
driver. Manual runs (`POST /api/superadmin/workflows/:id/runs`) go through the
same queue → Workflow path.

**Dev / fallback:** without the queue binding (vite dev, or
`WORKFLOW_DURABLE_EXECUTION=false`), runs execute inline via
`driveSuperadminWorkflowRunInline` — identical semantics, no durability.

### Run lifecycle

`queued → running ⇄ sleeping | waiting_approval → completed | failed | cancelled`

- **sleeping** — a timed task (`delay_minutes`, `daily_time_utc`) or retry
  backoff parked the run; the instance `step.sleep`s until due.
- **waiting_approval** — an approval node paused the run. Superadmins decide
  from the run detail drawer (`POST /runs/:id/approval`); undecided gates
  resolve via their `timeout_route` after `timeout_hours` (default 72 h).
- Failed operations retry with exponential backoff (default 3 attempts,
  `data.retry_policy.limit` overrides), then fail the run. Guards: 500 steps,
  24 h max run duration.
- Runs pin `template_version` at creation — mid-run edits never change a
  running graph.

### Key modules

- **`src/lib/server/superadmin-workflow-advance.ts`** — the durable advance
  loop (one node per call, state persistence, approval gates, timing, retry).
- **`src/lib/server/superadmin-workflow-runtime.ts`** — shared graph
  semantics (branch evaluation, edge routing, `{token}` templating, custom
  actions) + the legacy inline runtime.
- **`src/lib/server/superadmin-workflow-operations.ts`** — the operation
  registry. A task node's `data.operation` selects one of these.
- **`src/lib/db/superadmin-workflow-versions.ts`** — template version
  snapshots (see Version control).
- **`src/lib/server/superadmin-workflow-presets.ts`** — built-in templates
  mirroring the legacy cron jobs 1:1, plus a local-runner example. Marked
  `is_builtin`; the dispatcher re-seeds any missing preset on every tick.
- **`src/lib/server/cron-jobs.ts`** — the actual job implementations, shared
  with the legacy `/api/cron` endpoint so behavior is identical.
- **`src/lib/server/cron-match.ts`** — 5-field cron matcher (UTC, minute
  granularity; `*`, `*/n`, lists, ranges, dom/dow OR semantics).
- **`orchestrator-worker/src/superadmin-run-workflow.ts`** — the Cloudflare
  Workflow driver.

## Version control

Every definition change (name, schedule, canvas, config — not enable/disable
toggles) bumps `published_version` and writes a full snapshot to
`superadmin_workflow_template_versions`. The UI's **Versions** panel lists
history with change notes and diffs; **Revert** republishes an old snapshot as
a new version (git-revert style — history is append-only). Built-ins
additionally offer **Reset to built-in definition**.

Endpoints: `GET /:id/versions`, `GET /:id/versions/:v`,
`POST /:id/versions/:v/revert`, `POST /:id/reset-builtin`.

Built-ins cannot be archived (disable instead) and their slugs are immutable
(the seeder matches by slug).

## Run APIs

| Endpoint                                      | Method | Auth       | Purpose                           |
| --------------------------------------------- | ------ | ---------- | --------------------------------- |
| `/api/superadmin/workflows/runs/:id`          | GET    | superadmin | Run + per-step detail (drawer)    |
| `/api/superadmin/workflows/runs/:id/advance`  | POST   | Bearer/SA  | Execute at most one node (driver) |
| `/api/superadmin/workflows/runs/:id/approval` | POST   | superadmin | Record gate decision + wake       |
| `/api/superadmin/workflows/runs/:id/cancel`   | POST   | superadmin | Cancel a non-terminal run         |
| `/api/superadmin/workflows/runs/:id/fail`     | POST   | Bearer     | Driver poison marker              |

## Registered operations

`GET /api/superadmin/workflows/dispatch` returns the live catalog. Highlights:

| Operation                                                                | What it does                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `runStatsAggregation`                                                    | Hourly+daily aggregation for all active guilds                      |
| `fetchGuildStatsFromDiscord`                                             | Server stats + metadata refresh for all bot guilds                  |
| `refreshGuildCache`                                                      | Member/role cache refresh for all bot guilds                        |
| `cleanupOldData`                                                         | Prune old stats + cleanup expired operational data                  |
| `claimScheduledMessages` / `processScheduledMessages`                    | Scheduled message delivery                                          |
| `syncWorkersAICatalog`                                                   | Workers AI model catalog refresh                                    |
| `sweepAllTimedOutRunnerJobs`                                             | Runner job timeout hygiene                                          |
| `deleteAggregatedStats` / `runRebuildStats` / `verifyAggregateIntegrity` | Recovery path (destructive ops flagged)                             |
| `local_runner_job`                                                       | Dispatch a job to a local runner and optionally wait for the result |
| `http_request`                                                           | Generic HTTP call with `{token}` templating                         |
| `legacy_cron_job`                                                        | Per-step bridge to a named `/api/cron` job                          |
| `sleep`, `noop`                                                          | Structural helpers                                                  |

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

## Deployment

1. Create the runs queue once: `bunx wrangler queues create spacebot-workflow-runs`.
2. Deploy the orchestrator worker (`cd orchestrator-worker && bunx wrangler deploy`)
   — provisions both Workflows, both queue consumers, and the Cron Triggers.
3. Deploy the Pages app (push to main) and run `bun run db:migrate` for
   migration 0055 (version history + run state).
4. The PM2 `spacebot-cron` process is deploy-poll only now — scheduling lives
   entirely in the orchestrator worker's Cron Trigger.

Secrets: the worker needs `SPACEBOT_API_BASE` and `CRON_SECRET` (same value as
the Pages app's `CRON_SECRET`); `/api/cron` still exists for manual job
triggers, and node-less templates with `legacy_job_name` bridge to it.
