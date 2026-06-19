# SpaceBot AI Orchestrator Worker

Cloudflare Queue consumer for AI autopilot jobs, plus the cron-driven
scheduler for the superadmin workflows dispatcher and the AI watchdog sweep.

## Purpose

- Consume AI job queue messages.
- Trigger AI job execution in the Pages app via internal API endpoints.
- On a `* * * * *` Cron Trigger, run a Cloudflare Workflow
  (`CronDispatchWorkflow`) that durably calls the Pages app's superadmin
  workflows dispatch endpoint — this replaces the old GCP/PM2 tick
  (`scripts/cron.ts`) that used to drive scheduled superadmin workflow
  templates.
- On a `*/5 * * * *` Cron Trigger, enqueue an `ai_watchdog_sweep` message to
  trigger watchdog sweeps that recover stale jobs and requeue pending jobs.

## Queue Contract

Accepted message bodies:

- `{ "type": "ai_job_created", "jobId": <number>, "correlationId": "..." }`
- `{ "type": "ai_job_due", "jobId": <number>, "correlationId": "..." }`
- `{ "type": "ai_watchdog_sweep" }`

## Required Environment Variables

- `SPACEBOT_API_BASE`
  - Example local: `http://localhost:4269`
  - Example prod: `https://spacebot.pages.dev`
- `AI_AUTOPILOT_INTERNAL_KEY`
  - Shared secret used to call internal execution endpoints.
- `CRON_SECRET`
  - Shared secret used to call `POST /api/superadmin/workflows/dispatch`.
    Must match the Pages app's `CRON_SECRET`.

## Pages-side Requirements

- Queue producer binding named `AI_AUTOPILOT_QUEUE`.
- Internal endpoints:
  - `POST /api/ai/jobs/execute`
  - `POST /api/ai/jobs/sweep`
  - `POST /api/superadmin/workflows/dispatch`

## Deployment Notes

1. Create the Cloudflare Queue (for example `spacebot-ai-autopilot`).
2. Bind the queue producer in the Pages service and both the producer and
   consumer in this worker (this worker both consumes AI job messages and
   produces watchdog-sweep messages onto the same queue).
3. Set the same `AI_AUTOPILOT_INTERNAL_KEY` and `CRON_SECRET` values in both
   services.
4. Enable gateway enqueue mode with `DM_AUTOPILOT_ENABLED=true`.
5. `wrangler deploy` provisions the Cron Triggers and the `CronDispatchWorkflow`
   binding automatically — no Cloudflare dashboard steps required.

## Reliability Behavior

- Queue retries failed messages automatically.
- Execution endpoint applies bounded retry policy per job and persists retry decisions.
- Sweep endpoint recovers stale running jobs and requeues due pending jobs.
- `CronDispatchWorkflow` retries its dispatch call (up to 3 attempts, exponential
  backoff) before giving up on a given minute's tick; the dispatch endpoint's
  own per-template-per-minute dedup makes overlapping/duplicate ticks (e.g.
  during cutover from the old GCP tick) harmless no-ops.
