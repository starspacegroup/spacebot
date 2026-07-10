# Durable message purge

Delete actions that sweep a user's message history across **every channel** —
`DELETE_USER_MESSAGES`, `DELETE_MESSAGES`, `DELETE_MENTIONED_MESSAGES`, the kind
of thing a `/spam` moderation command runs — can be far more work than a single
Cloudflare request may do. Each Discord REST call is a subrequest, and a Pages
Function caps subrequests per invocation. A naive inline sweep therefore either
misses history past the first page or gets cut off mid-run on a busy server.

To make these reliable, a **server-wide** sweep is offloaded to a durable
Cloudflare Workflow that pages through history one bounded batch at a time.
Bounded, single-channel deletes still run inline on the edge.

## Flow

```
/spam interaction ──► POST /api/discord/interactions (edge, deferred type 5)
        │
        │  broad sweep (channel_ids = ALL) + queue available?
        ▼
  enqueueMessagePurge ──► WORKFLOW_RUNS_QUEUE  (spacebot-workflow-runs)
        │
        ▼
  orchestrator-worker queue consumer ──► MESSAGE_PURGE_WORKFLOW.create(purge-<interactionId>)
        │
        ▼
  MessagePurgeWorkflow loops:
        step.do ──► POST /api/discord/purge/advance   (one channel page / batch)
        step.sleep only on rate-limit backoff
        until { done: true }
```

- **Decision** (`src/routes/api/discord/interactions/+server.ts`): a delete action
  whose `channel_ids` is `ALL`/empty is offloaded when the durable queue is
  available (`canOffloadPurge`); otherwise it runs inline via the automation
  engine as before. The deferred reply becomes “🧹 Purging…”, then the advance
  endpoint live-edits it as the sweep runs.
- **Queue** (`src/lib/server/message-purge-queue.ts`): reuses the existing
  `spacebot-workflow-runs` queue and its dev/inline gating — no new binding or
  `wrangler queues create`. Message: `{ type: 'message_purge_start', purge, meta }`.
- **Workflow** (`orchestrator-worker/src/message-purge-workflow.ts`): a dumb
  driver. It holds no Discord logic — it just threads the purge **state** through
  repeated `POST /api/discord/purge/advance` calls. Each `step.do` gets a fresh
  subrequest budget, so the total sweep is unbounded by any single request. Its
  own `MAX_ITERATIONS` is only a runaway backstop; the real per-run cap is
  enforced Pages-side (below). Deterministic instance id `purge-<interactionId>`
  (or `-c<n>` for continuations) makes duplicate deliveries no-ops.
- **Advance endpoint** (`src/routes/api/discord/purge/advance/+server.ts`, Bearer
  `CRON_SECRET`): runs exactly one batch via the state machine, applies the batch
  cap, reports progress (interaction edit + a durable channel message on
  completion/stop), and returns the advanced state.

## Superadmin settings

Two `global_settings` keys, edited under **Admin → Superadmin → Message Purge**
(`src/lib/server/message-purge-settings.ts`, API
`/api/superadmin/settings/message-purge`):

- **`message_purge_max_batches`** (default 33) — max scan batches per run. A batch
  is one 100-message page; the first batch resolves the channel list, so 33 ≈ 32
  page scans (~3.2k messages). Clamped to 2–500.
- **`message_purge_checkpoint_continue`** (default off) — behaviour when a run
  hits the cap:
    - **off** → the run stops and posts “reached the scan limit — run again to
      continue”; the already-deleted messages stand.
    - **on** → the advance endpoint re-enqueues a continuation (a fresh workflow
      instance `purge-<interactionId>-c<n>`) that resumes from the saved cursor with
      a fresh batch budget. Chained continuations are capped by `MAX_CONTINUATIONS`
      (100) so a pathological sweep can't loop forever.

The cap is enforced on Pages, not in the worker, because the orchestrator worker
can't read D1 — the advance endpoint reads the settings and returns `done` (or
re-enqueues) once the cap is reached, and the workflow just stops when told.

The `batches` counter lives on the purge state and is incremented by the advance
endpoint (reset to 0 on each continuation); `decidePurgeOutcome` in
`message-purge.ts` is the pure branch (`complete` / `checkpoint` / `stop_capped` /
`continue`) and is unit-tested.

## State machine

`src/lib/server/message-purge.ts` is a pure, network-free, resumable state
machine (`runPurgeBatch`), with Discord I/O injected via the `DiscordApi`
interface (real impl in `message-purge-discord.ts`). One batch = one 100-message
page of the current channel:

- **Pagination**: fetches with a `before` cursor so it reaches messages past the
  most-recent 100 — the core thing a single fetch misses.
- **Filters**: target author (or mentions, in `mentions` mode), `max_age_days`
  cutoff (stops paging a channel once it crosses the cutoff, since messages are
  newest→oldest), `skip_pinned`, and a `max_messages` quota across all channels.
- **Deletes**: recent (<14 day) messages go through one bulk-delete call per 100;
  older messages are deleted individually, capped per batch so the driver can
  pace them.
- **Resume guarantee**: every non-rate-limited batch either advances the cursor
  or deletes ≥1 message, so the sweep always terminates. On a `429` the batch
  returns unchanged with a `sleep_seconds` hint; the driver sleeps and retries
  the same cursor. Inaccessible/deleted channels are skipped.

Unit tests: `src/tests/message-purge.test.ts` (pagination past 100, quota,
age cutoff, pinned, mentions mode, multi-channel, rate-limit resume).

## Inline path — one shared implementation

Small sweeps (an explicit channel or short list, or any delete when the durable
queue is unavailable) run inline, and both runtimes now share a **single**
implementation: `src/lib/automation/message-delete.ts` (`purgeMessages` plus
`deleteUserMessages` / `deleteMessagesByUser` / `deleteMentionedMessages`). It
paginates with a `before` cursor (past the first 100 messages), bulk-deletes
recent messages + deletes older ones individually, and stops once it has scanned
`max_batches × 100` messages — so the **same superadmin lookback setting governs
every message-lookback delete**, not just the offloaded `/spam` sweep.

Both callers pass their own discord.js-shaped client into the shared functions:

- **Edge engine** (`engine.ts`, via the `createRESTClient` REST shim) — runs on
  the edge with D1, so it reads the setting directly (`getMessageScanCeiling`).
- **Gateway** (`gateway.ts` `executeAutomationAction`, via the real discord.js
  client) — used for automations triggered by live events. The gateway has no
  direct D1, so it fetches the lookback value over HTTP from
  `GET /api/gateway/message-purge-settings` (bot-token authed, 30 s cached) and
  passes it as `maxScan`.

These were previously two copy-pasted implementations that had drifted (the
gateway copy still had the original no-pagination bug); they are now one, so a
fix or a settings change applies everywhere. The edge REST shim exposes
`mentions.has()` so `DELETE_MENTIONED_MESSAGES` works through the shared code on
both sides.

> Changes to the gateway path require a **gateway restart** to take effect
> (`bun run gateway:restart`); the edge paths ship with the normal Pages build.

## Deploy / ops

- The Workflow ships with the orchestrator worker: `cd orchestrator-worker &&
bunx wrangler deploy`. No new secret — it drives the Pages advance endpoint
  with the existing `CRON_SECRET`; the bot token stays on Pages.
- The Pages side ships with the normal Cloudflare Pages build (no gateway
  restart needed for the slash-command path).
- In vite dev (or `WORKFLOW_DURABLE_EXECUTION=false`), the queue is treated as
  absent and sweeps run inline instead.
