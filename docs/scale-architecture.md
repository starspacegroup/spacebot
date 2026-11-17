---
title: Scale Architecture
layout: default
---

# Scale Architecture

SpaceBot runs on Cloudflare Pages + one D1 database (`spacebot-logs`), an
orchestrator worker (queues, workflows, crons) and a pm2 Discord gateway on a
GCP VM. On 2026-11-05 `spacebot-logs` was **1.2 GB of D1's 10 GB cap**, and
most of it was log tables that were never pruned. That cap is what breaks
first, well before any throughput limit.

## The plan

| Phase               | What                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 (this branch)** | Retention for every append-only table; rate limiter on a Durable Object; limiter identity from the verified session; DLQ + `max_retries` on both queue consumers; one fewer dispatch read.                                                  |
| 2 (next)            | Event/command logs move to Workers Analytics Engine or R2 (NDJSON per day), D1 keeps rollups. D1 read replication (Sessions API) for dashboard reads. The per-minute cron dispatches directly and starts a Workflow only when a job is due. |
| 3 (later)           | A per-guild Durable Object (`GuildStore`) when one guild's data or traffic dominates. The gateway on the VM keeps posting through the API, unchanged.                                                                                       |

## What phase 1 changed

**Retention** (`src/lib/db/log-retention.ts`, details in
[Data Retention](data-retention.md)). command/automation/button/user-activity
logs keep 90 days; terminal `ai_jobs` (+ events) 30 days; `cron_job_history`
and terminal workflow runs (+ steps) 90 days; cron claims 1 day;
`site_view_hourly` 30 days. Each table has its own nightly budget
(`LOG_RETENTION_<KEY>_MAX_ROWS`), the walk reads primary-key windows so a
table with nothing to delete is not scanned, and each run logs the oldest
remaining row's age. The existing `event_logs` budget (2,500/night,
`EVENT_LOG_RETENTION_MAX_ROWS_PER_RUN`) is unchanged; the DB is past the free
tier's 500 MB, so it is on Workers Paid and that budget can be raised.

**Rate limiter on a Durable Object.** `RateLimiter`
(`orchestrator-worker/src/rate-limiter.ts`) is one SQLite-backed object per
`group:identity`. Increment and read are one `RETURNING` statement, so
parallel requests get distinct counts; an alarm deletes expired windows and
empties idle objects. Pages cannot host DO classes, so the class lives in
`spacebot-ai-orchestrator` and Pages binds it with `script_name`. Both
`checkRateLimit` and `consumeQuota` use it when `RATE_LIMITER` is bound and
fall back to the old D1 path when it is absent or errors. The decision
(`src/lib/server/rate-limit-core.ts`) is shared, and
`src/tests/rate-limit-do.test.ts` checks that both backends decide
identically on 200 random sequences and that 50 parallel calls never allow
more than `max`.

**Limiter identity.** `rateLimitIdentity` no longer trusts the
`discord_user_id` cookie (client-set; rotating it gave a fresh bucket). It
uses `bearer:<prefix>`, then `user:<locals.userId>` (verified from the signed
`sb_session` cookie), then `ip:<cf-connecting-ip>`.

**Queues.** Both consumers have `max_retries = 5` and
`dead_letter_queue = "spacebot-orchestrator-dlq"`.

**Dispatch.** The cron dispatch no longer reads `superadmin_workflow_runs`
before the `INSERT OR IGNORE` claim; the claim alone decides.

## Before the next deploy (David)

1. Create the DLQ, or the orchestrator-worker deploy fails:
   `bunx wrangler queues create spacebot-orchestrator-dlq`
2. Deploy `orchestrator-worker`. It carries the DO migration
   (`tag = "v1-rate-limiter"`, `new_sqlite_classes = ["RateLimiter"]`), which
   creates the class.
3. Only then uncomment the `[[durable_objects.bindings]]` block at the end of
   the root `wrangler.toml` and deploy Pages. Until then the limiter runs on
   D1 exactly as before. (If Pages bindings are managed in the dashboard
   instead, add `RATE_LIMITER` → `RateLimiter` on `spacebot-ai-orchestrator`
   there.)
4. The first nightly run starts draining months of log backlog at up to the
   per-table budgets. Watch the `[Retention] <table>: ... oldest remaining Nd`
   lines; if a table's age does not fall night over night, raise its
   `LOG_RETENTION_<KEY>_MAX_ROWS`.

No D1 migration is needed: every change is code or worker config.

## Still open

- Queue batches are handled serially (`orchestrator-worker/src/index.ts`).
- 140 `SELECT *` queries.
- `spacebot-computer-control` shares the production D1 id but stops at
  migration 0080; deploying it would run old code against the new schema.
- `consumeQuota` callers key on server id; `checkRateLimit` is still opt-in
  (`RATE_LIMIT_ENABLED`).
