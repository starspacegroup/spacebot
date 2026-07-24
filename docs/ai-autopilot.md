---
title: AI Autopilot (Workflows + Queues Foundation)
layout: default
---

# AI Autopilot (Workflows + Queues Foundation)

This document describes the initial implementation for durable DM AI execution with retries, recovery, and timeline visibility.

## What Is Implemented

- Durable AI job tables:
    - `ai_jobs`
    - `ai_job_events`
- Gateway enqueue endpoint:
    - `POST /api/gateway/dm-autopilot`
- Executor endpoint:
    - `POST /api/ai/jobs/execute`
- Watchdog sweep endpoint:
    - `POST /api/ai/jobs/sweep`
    - Cron `*/15 * * * *` (was `*/5` — stretched 2026-07-24 after the sweep burned
      the Queues free tier's 10,000 daily operations). Requeue policy: each requeue
      pushes the job's `next_retry_at` out exponentially (5→10→20… min, capped at a
      day) so a stuck job isn't re-enqueued every sweep, and after
      `MAX_WATCHDOG_REQUEUES` (8) requeues without progress the job is
      `failed_terminal` (`job.requeue_capped` event) instead of looping forever.
      Failed sweep messages are acked, not retried — the next tick supersedes them.
- Timeline lookup endpoint:
    - `GET /api/ai/jobs/:jobId`
    - `:jobId` can be numeric DB id or `correlation_id`
- Dedicated queue consumer worker scaffold:
    - `orchestrator-worker/`

## Feature Flags and Secrets

Pages/Gateway env vars:

- `DM_AUTOPILOT_ENABLED=true`
- `AI_AUTOPILOT_INTERNAL_KEY=...`
- `AI_RETRY_ASSESSOR_MODE=bounded` (or `llm` for bounded LLM stub mode)

Worker env vars:

- `SPACEBOT_API_BASE` (Pages URL)
- `AI_AUTOPILOT_INTERNAL_KEY` (same as Pages)

## Queue Binding

Pages producer binding is expected as:

- `AI_AUTOPILOT_QUEUE` bound to queue `spacebot-ai-autopilot`

The consumer is configured in `orchestrator-worker/wrangler.toml`.

## Request Flow

1. Gateway receives DM and checks manager access.
2. If local-runner dispatch does not take over and `DM_AUTOPILOT_ENABLED=true`, gateway calls `POST /api/gateway/dm-autopilot`.
3. Job is persisted as `pending` + timeline event `job.queued`.
4. Job message is sent to queue.
5. Orchestrator worker consumes queue and calls `POST /api/ai/jobs/execute`.
6. Executor claims job atomically (`pending -> running`), runs `generateChatResponse`, then DMs user.
7. On transient failure, bounded retry decision schedules `next_retry_at` + `job.retry_scheduled`.
8. On terminal failure, job is marked `failed_terminal` and user receives failure DM.
9. Watchdog endpoint recovers stale running jobs and requeues due pending jobs.

## Bounded Intelligent Retry

The policy hook is in `src/lib/ai/retry-policy.ts`.

- Classifies error into bounded classes.
- Applies strict max-attempt and max wall-clock constraints.
- Computes bounded exponential backoff with jitter.
- Optional `llm` mode currently uses a bounded stub that can be replaced later.

## User Visibility

- Gateway enqueue reply includes correlation id.
- Timeline endpoint returns full state and ordered events.
- Every execution stage appends explicit events (`queued`, `running`, `executing`, `delivering`, `retry_scheduled`, `completed`, `failed_terminal`).

## Rollout Sequence

1. Run migration `0048_ai_orchestration_jobs.sql`.
2. Deploy Pages changes.
3. Deploy orchestrator worker and queue bindings.
4. Set `AI_AUTOPILOT_INTERNAL_KEY` in both services.
5. Enable `DM_AUTOPILOT_ENABLED=true`.

## Current Scope Notes

- This is a production-focused foundation, not the final Workflow graph.
- Existing local-runner DM/screenshot path is preserved and still executes first.
- Workflow-native branching/checkpointing can now be layered onto this durable contract.
