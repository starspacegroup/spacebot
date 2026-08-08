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
  **2,500**) means a large backlog drains over successive nights instead of in
  one pass.
- That budget is shared fairly across guilds: each guild gets `budget / guilds`
  before any guild gets seconds, so one busy server cannot starve the rest.

### Why the budget is 2,500 and not larger

It is sized against D1's **write** cap, which is the binding constraint — not the
read cap everything else in this codebase has had to worry about. The free tier
allows ~100k rows written/day, and `event_logs` carries **seven** indexes, so one
deleted row costs roughly 8 row-writes once index maintenance is counted. 2,500
deletions ≈ 20k writes — and this is only one of four retention deletes sharing
the same nightly allowance (see the table below), which together come to ~44k.

The trade-off is deliberate. A backlog of 240k rows takes ~96 nightly runs to
clear at 2,500/night (the original end-to-end simulation drained 261k rows → 21k
with aggregates intact in half that, at the old 5,000 budget). A retention job
that tripped the write cap would take live event logging down with it, which is
strictly worse than draining slowly. On Workers Paid the cap is far higher —
raise the env var then.

## Configuration

| Env var                                | Default | Effect                                                    |
| -------------------------------------- | ------- | --------------------------------------------------------- |
| `EVENT_LOG_RETENTION_DAYS`             | `90`    | How far back the log viewer can go.                       |
| `EVENT_LOG_RETENTION_MAX_ROWS_PER_RUN` | `2500`  | Per-night deletion ceiling. `0` skips retention entirely. |

Retention runs inside the `cleanupOldData` workflow operation, which is the `cleanup` step
of the seeded `daily-server-intelligence-refresh` preset (`0 0 * * *`). That preset is
topped up automatically by the dispatcher and driven by `orchestrator-worker`'s Cron
Trigger, so no manual scheduling is required.

It was added to that operation rather than as a new preset node on purpose: the seeder
only inserts **missing** slugs, so a change to the preset definition would not reach an
already-seeded production template without an operator using _Reset to built-in
definition_. Extending the operation that the existing node already calls means retention
starts on the next nightly tick with no operator action.

`runDailyRefresh` also calls event-log retention, for the legacy `POST /api/cron`
(`job=daily_refresh`) path. Nothing in this repo invokes that endpoint, but if it is ever
wired up both paths would prune on the same day — harmless, since each is separately
budgeted.

### The shared write budget

All four retention deletes run in that one nightly job, so they share a single allowance
rather than each having its own. Sized in isolation they summed to ~88k row-writes —
roughly 88% of D1's ~100k/day cap, leaving almost nothing for live logging:

| Delete                      | Rows/run | Indexes | ~Row-writes |
| --------------------------- | -------- | ------- | ----------- |
| `event_logs`                | 2,500    | 7       | 20,000      |
| `voice_sessions`            | 1,500    | 4       | 7,500       |
| `aggregated_stats` (hourly) | 1,500    | 4       | 7,500       |
| `server_stats`              | 1,500    | 5       | 9,000       |
| **Total**                   |          |         | **~44,000** |

That leaves over half the day's writes for live event logging. Backlogs drain over
successive nights, which is the intended trade-off.
