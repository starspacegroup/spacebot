---
title: Data Retention
layout: default
---

# Data Retention

Long-term history is kept as **aggregates**, which are tiny; the raw event
firehose underneath them is pruned. This is what lets trends survive
indefinitely without the row counts that caused the D1 blowouts.

## The pipeline

```
event_logs  ──hourly rollup──►  aggregated_stats (hourly)  ──daily rollup──►  aggregated_stats (daily)
   raw                              pruned at 30 days                              kept forever
pruned at 90 days
```

| Data                          | Retention                            | Why                                                                                                        |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `aggregated_stats` **daily**  | **Forever**                          | ~18 small columns, one row per guild per day — ~365 rows/guild/year. Charts and trends never lose history. |
| `aggregated_stats` **hourly** | 30 days                              | Intermediate; its content is already folded into daily.                                                    |
| `event_logs` (raw)            | 90 days (`EVENT_LOG_RETENTION_DAYS`) | The firehose. Powers the log viewer, which is a recent-activity tool.                                      |
| `voice_sessions`              | 90 days                              | Pre-existing (`cleanupOldData`).                                                                           |
| `server_stats`                | 90 days                              | Pre-existing (`pruneOldStats`).                                                                            |

**What you lose by pruning raw events:** the log viewer can only go back 90
days. **What you keep:** every chart, trend and aggregate, permanently.

## Two rules that keep the prune safe and cheap

`pruneAggregatedEventLogs` (`src/lib/db/event-log-retention.ts`) runs in the
daily refresh, after the existing cleanup steps.

**1. Never delete ahead of the permanent record.** A guild's cutoff is capped at
its newest _daily_ `period_end`. Daily is the artifact that survives, so anything
older than it is preserved in aggregate. A guild with **no** daily aggregate is
skipped entirely — its history exists nowhere else, and a clock alone must not
authorise deleting it. Guilds are handled independently, so one guild whose
aggregation is broken cannot stall pruning for the rest.

This matters because daily aggregates are built from _hourly_, and hourly is
pruned at 30 days: once hourly is gone, daily cannot be rebuilt. Daily is
therefore the only safe watermark.

**2. The prune must not become the next blowout.** The 2026-07-27 incident was
partly caused by a retention query that scanned its table twice per flush. So:

- Deletes are batched (`LIMIT`-bounded subselect on `id`), never one large
  statement.
- The subselect is served by `idx_event_logs_guild_created` — verified with
  `EXPLAIN QUERY PLAN` in the tests, which assert no bare `SCAN event_logs`.
- A hard per-run row budget (`EVENT_LOG_RETENTION_MAX_ROWS_PER_RUN`, default
  **5,000**) means a large backlog drains over successive nights instead of in
  one pass.

### Why the budget is 5,000 and not larger

It is sized against D1's **write** cap, which is the binding constraint — not the
read cap everything else in this codebase has had to worry about. The free tier
allows ~100k rows written/day, and `event_logs` carries **seven** indexes, so one
deleted row costs roughly 8 row-writes once index maintenance is counted. 5,000
deletions ≈ 40k writes: under half the daily allowance, leaving room for live
logging.

The trade-off is deliberate. A backlog of 240k rows takes ~48 nightly runs to
clear (simulated end-to-end: 261k rows → 21k, aggregates intact). A retention job
that tripped the write cap would take live event logging down with it, which is
strictly worse than draining slowly. On Workers Paid the cap is far higher —
raise the env var then.

## Configuration

| Env var                                | Default | Effect                              |
| -------------------------------------- | ------- | ----------------------------------- |
| `EVENT_LOG_RETENTION_DAYS`             | `90`    | How far back the log viewer can go. |
| `EVENT_LOG_RETENTION_MAX_ROWS_PER_RUN` | `5000`  | Per-night deletion ceiling.         |

Retention only runs as part of the daily refresh, so it inherits that job's
scheduling — see the deployment note in
[Server Browser](server-browser.md#visibility-rules) about confirming the daily
refresh actually runs.
