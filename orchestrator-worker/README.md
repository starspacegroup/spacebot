# SpaceBot AI Orchestrator Worker

Dedicated Cloudflare Queue consumer for AI autopilot jobs.

## Purpose

- Consume AI job queue messages.
- Trigger AI job execution in the Pages app via internal API endpoints.
- Trigger watchdog sweeps that recover stale jobs and requeue pending jobs.

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

## Pages-side Requirements

- Queue producer binding named `AI_AUTOPILOT_QUEUE`.
- Internal endpoints:
  - `POST /api/ai/jobs/execute`
  - `POST /api/ai/jobs/sweep`

## Deployment Notes

1. Create the Cloudflare Queue (for example `spacebot-ai-autopilot`).
2. Bind the queue producer in the Pages service and consumer in this worker.
3. Set the same `AI_AUTOPILOT_INTERNAL_KEY` in both services.
4. Enable gateway enqueue mode with `DM_AUTOPILOT_ENABLED=true`.

## Reliability Behavior

- Queue retries failed messages automatically.
- Execution endpoint applies bounded retry policy per job and persists retry decisions.
- Sweep endpoint recovers stale running jobs and requeues due pending jobs.
