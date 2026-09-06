# SpaceBot Development Roadmap

This document outlines future enhancements and features. Status reflects what is
actually implemented in the codebase (reconciled 2026-06-18 against a full
feature inventory). Items marked _(partial)_ or checkbox `[~]` exist but are scaffold-only / not fully wired / require external setup.

## Priority: High

### Authentication & Authorization

- [x] Implement full Discord OAuth session management — `src/hooks.server.ts`, `src/routes/api/auth/discord/`
- [x] Add Cloudflare KV or D1 storage for user sessions — cookie sessions + D1 user store
- [x] Complete admin authorization logic (check ADMIN_USER_IDS)
- [x] Add logout functionality — `/api/auth/logout`
- [x] Implement session expiration and refresh — configurable sliding session TTL + OAuth
      access-token refresh (`src/lib/server/discord-session.ts`)

### Discord Bot Features

- [x] Add more slash commands — custom command system (`src/lib/db/commands.ts`)
- [x] Implement message context menu commands — message context menu registration + routing
- [x] Add user context menu commands
- [x] Create button and select menu interactions — `src/lib/db/button-actions.ts`
- [x] Add modal (form) interactions — automation action system
- [x] Implement command permission controls — server-side command permission enforcement
- [x] Member-owned rooms (#45) — `/room` (a built-in subcommand family) and join-to-create
      lobbies let members make their own text or voice channels from an admin-defined preset,
      manage only their own, and have them close on a fixed TTL or an idle window
      (`docs/managed-channels.md`)
- [x] Subcommand options — the interaction handler now walks subcommand and group wrappers
      down to the leaf options, and registration sends their children to Discord

### Database & Persistence

- [x] Set up Cloudflare D1 database — `wrangler.toml`
- [x] Create schema for server settings, user data, bot statistics, command usage logs — 61 migrations
- [x] Implement data migration scripts — `scripts/migrate.ts`

## Priority: Medium

### Admin Dashboard Enhancements

- [x] Real-time bot status monitoring — live updates / gateway logs
- [x] Command usage analytics and charts — stats dashboard + `ChartCard`
- [x] Server management interface — `/admin/[serverId]/`
- [x] User management and permissions — superadmin user management
- [x] Bot configuration editor — settings persistence, validation, and toast feedback
- [x] Audit log viewer — event logs + user activity

### Bot Statistics

- [x] Track command usage per server
- [x] Track active users and servers
- [x] Calculate uptime and latency metrics — gateway benchmarks
- [x] Store historical data for trends — stats aggregation (hourly/daily)
- [x] Export statistics as reports — JSON/CSV stats export

### API Endpoints

- [x] Create REST API for bot stats — `/api/stats/`, `/api/v1/`
- [x] Add webhook endpoints for external services — `/api/webhooks/`, GitHub integration
- [x] Implement rate limiting on API endpoints — D1-backed helper with route policies/exemptions
- [x] Add API authentication tokens — API keys + integration tokens

## Priority: Low

### Frontend Improvements

- [x] Add dark mode toggle — `src/lib/theme.svelte.ts`
- [x] Improve responsive design for mobile
- [x] Add loading states and skeletons — shared `Skeleton` component
- [x] Implement error boundaries — SvelteKit `+error.svelte`
- [x] Add toast notifications — global toast store + container
- [x] Create animated transitions — reduced-motion-aware route/UI transitions

### Developer Experience

- [x] Add TypeScript support — full JS→TS migration (all `src/` + `scripts/` are `.ts`, components `<script lang="ts">`, `bun run typecheck` via svelte-check)
- [x] Set up ESLint and Prettier — flat ESLint config, Prettier config, package scripts
- [x] Add pre-commit hooks with Husky — lint-staged formatting hook
- [x] Create component library/design system
- [x] Add Storybook for component documentation

### Testing

- [x] Set up Vitest for unit tests — 507 tests across 66 files
- [x] Add Playwright for e2e tests — smoke scaffold + `bun run test:e2e`
- [x] Create test coverage reports — `bun run test:coverage` (v8)
- [x] Add CI/CD testing pipeline — GitHub Actions test workflow
- [x] Mock Discord API for testing — vi.mock in test suite

### Documentation

- [x] Add inline code documentation (JSDoc)
- [x] Create API documentation
- [x] Add architecture diagrams — `docs/architecture.md`
- [x] Write contributing guidelines — `CONTRIBUTING.md`
- [~] Create video tutorials — _(Markdown outlines with hosted-video **placeholders** in `docs/tutorials.md`; no actual videos)_

## Optional Enhancements

### Advanced Features

- [~] Multi-language support (i18n) — _(wired: cookie/Accept-Language locale resolution, dynamic `<html lang>`, en/es catalog, `LanguageSelector`, public pages translated; full app-wide string translation still pending)_
- [x] Custom branding per server
- [x] Plugin/extension system — external integrations framework (`docs/integrations.md`)
- [x] Integration actions/events/templates — integrations can contribute **actions** into the shared action system (composable commands), declare & push custom **events** into automations (routed to a designated official guild via `official_guild_id`, migration 0056), and ship one-click **command templates** cloned into a guild's own commands. Backend + sync validation + builder merge + dashboard UI (template gallery on the integrations page, official-guild setter in superadmin) + docs, landed 2026-07-21 (AgapeVerse is the driving integration). Contributed `configSchema` normalized (`string`→`text`, select `choices`→`options`); `action_handler` contract documented
- [x] Integration template variables (Part D) — integrations declare per-user **variables** in the manifest (`{agapeverse.account_url}`, `{agapeverse.display_name}`, …, scopes `user`/`global`) that appear as a slug-grouped section in the message editor's `{} Variable` picker (merged into all 4 builder loads via `getGuildContributedVariables`) and resolve at send time through ONE batched `variables_handler` call keyed by Discord user ID (`src/lib/integrations/variables.ts`: 2 s timeout, ~2 min cache, empty-string fallback — never a blocked send or a literal placeholder; engine `executeAction` + interactions-route augmentation so response-only templates resolve too). Sync-validated + namespaced; contract in `docs/integrations.md` § Template Variables; 19 tests. No schema change. Landed 2026-07-23
- [x] Automation loop guard + reply-in-trigger-channel — SpaceBot's own messages no longer trigger automations by default (`matchesFilters` skips `details.isOwnBot` events unless the new `own_bot_messages` filter is set to `include`), closing the self-retrigger loop for automations that post into a channel they also watch; `SEND_MESSAGE` gained the `channel_source` option (`configured` / `trigger`) so an automation can reply in whatever channel fired it, honored by both the edge engine and the gateway executor (landed 2026-07-23)
- [x] Option-driven command visibility (ephemeral) — a command's `ephemeral` can be tied to one of its own options via the new nullable `ephemeral_option` column (migration 0057): a **boolean** option (`"private"` / `"!public"`) or a **choice** option matched by value (`"visibility=private"`, comma-lists + `!` negation). Resolved per-invocation in `resolveEphemeralFlag`/`parseEphemeralOptionRef` **before** the defer decision so it works with `defer: true` and coexists with a response template. Declarable by integration **command templates** (sync-validated against declared options) and exposed in the dashboard command builder (new + edit). Landed 2026-07-23. **Extended 2026-07-25:** a ref may now carry several `;`-separated conditions across _different_ options, OR'd — e.g. `publicity=draft,community;anonymous` — with per-condition negation; conditions whose option the user omitted are skipped, and the static boolean decides only when every referenced option is absent. Grammar/parsing moved to the DB-free `src/lib/command-ephemeral.ts` (re-exported from `db/commands.ts`) so the builder imports it client-side; the builder now renders one condition row per condition with checkboxes for a choice option's values. Manifest sync validates every referenced option (`templateEphemeralOptionRefs`). No schema change
- [x] Scheduled tasks and cron jobs — superadmin workflows on Cloudflare Cron Triggers + Workflows (PM2 tick retired to deploy-poll only)
- [x] Durable workflow execution — per-run Cloudflare Workflow instances (queue-driven advance loop, approval gates, timed steps, retry/backoff, watchdog)
- [x] Durable message purge — server-wide delete sweeps (`/spam`-style) offloaded to a `MessagePurgeWorkflow` that pages history one bounded batch at a time via `/api/discord/purge/advance`, escaping the per-request subrequest cap; superadmin-tunable per-run batch cap + optional checkpoint-and-continue (Admin → Superadmin → Message Purge). Inline delete actions unified into one shared paginated implementation (`message-delete.ts`) used by both the edge engine and the gateway (which reads the lookback setting over HTTP), so one lookback setting governs every message-lookback delete (`docs/message-purge.md`)
- [x] Workflow version control — every definition change snapshotted (`superadmin_workflow_template_versions`); revert to any version + reset-to-built-in from the UI
- [x] Workflow builder UI v2 — componentized step-list builder (no raw-JSON fallback), run drill-down with live approval decisions, version history panel
- [x] Webhook integrations — webhooks + GitHub integration

### Monitoring & Observability

- [x] Set up Sentry for error tracking — client (`src/hooks.client.ts`, `PUBLIC_SENTRY_DSN`) + server (`src/hooks.server.ts`, per-request init via `@sentry/cloudflare` `wrapRequestHandler`, gated on `SENTRY_DSN`)
- [~] Add application performance monitoring (APM) — _(scaffold: `src/lib/server/telemetry.ts`; requires an external APM backend)_
- [x] Implement structured logging — `src/lib/log.ts` (LOG_LEVEL)
- [~] Create Grafana dashboards — _(docs/dashboard JSON under `docs/grafana/`; requires a running Grafana)_
- [~] Set up alerting for critical issues — _(documented in `docs/alerts.md`; requires external alerting infra)_

### Security Enhancements

- [x] Add CSRF protection — same-origin helper for cookie-authenticated JSON mutations
- [x] Implement content security policy (CSP) — report-only HTML CSP from hooks
- [x] Add request signing for webhooks — Discord interaction signature verification
- [x] Set up security headers — HTML response hardening in hooks
- [x] Regular dependency audits and updates

### Performance

- [x] Implement caching strategies — guild cache, AI gateway caching
- [x] Add service worker for offline support
- [~] Optimize images and assets — _(audit script `scripts/check-images.ts`; no automated optimization step yet)_
- [~] Enable HTTP/3 on Cloudflare — _(verify script `scripts/verify-http3.ts` + `docs/http3.md`; actual enablement is a Cloudflare dashboard setting)_
- [x] Add CDN for static assets — Cloudflare edge

#### Workers/Pages daily-request pressure (account-wide alerts) — 2026-07-10

**SpaceBot is the top request generator on the Cloudflare account** (`David
Monaghan`, `7170285216…`) and the main driver of the recurring "[Alert] Your
Workers daily request usage is at 75%" / "daily request limit exceeded" emails.
The free plan caps **Workers + Pages Functions at 100,000 requests/day**,
account-wide (shared across every app).

Evidence (Cloudflare analytics, 2026-07-09): `spacebot.starspace.group` served
**42,555 requests/day** — ~6× the next app (`dashboard` ~11k) and the single
largest slice of the account's request budget.

**This is NOT a KV problem.** SpaceBot has no `kv_namespaces` binding (D1 + Queues
only), so it contributes nothing to the separate KV operation limits — the KV
alerts are Dashboard's. Do not "optimize KV" here; reduce request _count_.

- [ ] Attribute the 42k/day: split bot-interaction traffic (Discord webhooks,
      unavoidable) from web/SSR page loads and polling that can be cached or
      collapsed. Add per-route request logging to see the hot paths.
- [ ] Cache SSR/GET responses at the edge (Cache API / `Cache-Control`) so
      repeat loads don't re-invoke the Function; move static/JSON to assets.
- [ ] Audit any client polling (dashboards, live views) — widen intervals or
      switch to push where possible; each poll is a billable request.
- [ ] If genuine traffic warrants it, the Workers Paid plan ($5/mo) lifts the
      100k/day request cap — a real option once the cheap wins are exhausted.

#### Queues daily-operations limit burned by watchdog requeue loop — FIXED 2026-07-24

Cloudflare Queues free tier = **10,000 operations/day**; the account hit 100% on
2026-07-23 (75%→90%→100% alerts through the afternoon). Cause: the `*/5` watchdog
sweep re-enqueued every due pending AI job with **no backoff and no cap** —
`getDuePendingAIJobs` returns any pending job whose `next_retry_at` is due, and the
sweep never advanced it, so one stuck job cost ~860 ops/day (288 sweeps × 3 ops).
Fix (same day): sweep requeues now defer `next_retry_at` exponentially
(5→10→20…min, ≤1 day), jobs hit `failed_terminal` after 8 requeues without
progress (`job.requeue_capped`), failed enqueues also defer (a capped queue isn't
hammered at reset), sweep cron stretched to `*/15`, and failed sweep messages are
acked, not retried. Steady state ≈ 400 ops/day. Taxonomy: footgun #5 (resource
trap — retries hiding a dead dependency).

#### D1 rows-read blowout from polling loops and a per-flush table scan — FIXED 2026-07-27

D1 free tier = **5M rows read/day**; `spacebot-logs` was running **17M–75M/day**
(readQueries only ~150–220k/day, i.e. ~100–400 rows read _per query_ — the tell that
a few queries were scanning tables). Five causes, all measured from
`d1QueriesAdaptiveGroups` over 2026-07-25→27:

| Query                                                                 | rows read / 3d | per call | Cause                                                                                                                                              |
| --------------------------------------------------------------------- | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE FROM gateway_logs WHERE id NOT IN (SELECT … LIMIT ?)`         | 15.1M          | 4,009    | ran after **every** log flush; the anti-join scanned the whole table plus a 2,000-row subquery                                                     |
| `SELECT DISTINCT guild_id FROM event_logs WHERE created_at >= …`      | 11.5M          | 75,460   | full scan of the largest table to produce ~9 guild ids                                                                                             |
| `SELECT … FROM voice_sessions WHERE guild_id = ? AND left_at IS NULL` | 5.3M           | 165      | gateway posted a voice snapshot for **every** guild every 60s, even with nobody in voice                                                           |
| two `voice_sessions` aggregation counts                               | 9.0M           | ~820     | hourly cron ran with `repair: true`, re-walking a **7-day / ~168-period** window every hour                                                        |
| `SELECT value FROM global_settings WHERE key = ?`                     | 262k calls     | 1        | gateway polled every 5s and fanned 6 keys into 6 queries, plus a heartbeat **write** every poll (53.5k writes/3d — the most-written row in the DB) |

Fixes:

- [x] `gateway_logs` trim is now an id-watermark range delete
      (`WHERE id <= (SELECT MAX(id) …) - ?`) — two rowid seeks instead of two full
      scans. ~4,009 → ~4 rows read per flush.
- [x] `getGuildsWithLogs` uses a recursive **loose index scan** over
      `idx_event_logs_guild_created` + a per-guild `EXISTS` — O(guilds), not
      O(events). Verified against SQLite: identical results, 300k-row table 22.5ms → 0.14ms.
      The three duplicated copies (`scheduled.ts`, `api/stats/aggregate`, `cron-jobs.ts`)
      now share one implementation; a fourth inline copy in `runRebuildStats` too.
- [x] Voice minute-poll skips guilds that are empty now **and** were empty at the last
      successful post (`voiceSessionKnownEmptyGuilds`). Real voice changes still post
      immediately via `VOICE_STATE_UPDATE`; `client_ready` / `shard_resume` still do a
      full pass.
- [x] Hourly aggregation is **incremental** (`repair: false`); the 7-day/14-day repair
      sweep moved to `runDailyStatsRepair`, invoked once a day from `runDailyRefresh`.
      The live paths (slash commands, widgets) stopped repairing too.
- [x] `getGlobalSettings(db, keys)` reads all six keys in one query; gateway config poll
      5s → 15s; heartbeat row written at most every 30s (connected window 20s → 90s).
- [x] Superadmin dashboard + gateway log viewer stop polling while the tab is hidden.

Taxonomy: footgun #5 again (resource trap), plus "a repair window that was meant to be
occasional wired onto the recurring path".

#### D1 rows-read, second round: the logs page — FIXED 2026-08-03

The 07-27 sweep fixed the timer-driven offenders but missed the largest _continuous_
one, because it only bites while a human has a tab open.

`admin/[serverId]/logs` polls every 10s with **no visibility guard**, and every poll sent
`stats=true`. With no filters selected the where clause is just `WHERE guild_id = ?`, so
each poll ran **four unbounded scans of `event_logs`**: the pagination `COUNT(*)`, plus
`getLogStats`'s total, by-category and by-event-type aggregates. Only the 24h bucket query
was index-bounded. At ~20k events for one guild that is the whole 5M/day budget in about
ten minutes, from a single backgrounded tab.

- [x] `getLogs` gained `includeTotal`, returning `total: null` rather than a misleading
      `0`, so callers can tell "not asked" from "empty"; the API exposes `?count=false`.
- [x] The page's auto-refresh asks for neither stats nor count — a poll is now one indexed
      `LIMIT` read instead of four table scans. `if (result.stats)` already guarded the
      client assignment; `total` needed the same guard.
- [x] Visibility guards + foreground catch-up on the logs, stats and vc-activity pages,
      matching what the superadmin page already had.
- [x] `mcp-client.listGuilds()` still ran the naive `SELECT DISTINCT guild_id FROM
event_logs` that 07-27 replaced in `cron-jobs.getGuildsWithLogs`: the fix had been
      applied to one of two copies. Both now build from `src/lib/db/distinct-guilds.ts`.
- [x] **Raw `event_logs` retention** (2026-08-03) — `pruneOldLogs()` had no caller, so the
      table grew without bound and every scan over it got slower forever. Replaced with
      `pruneAggregatedEventLogs` in the daily refresh, on two rules: never delete ahead of
      a guild's **daily**-aggregate watermark (daily is the artifact that survives, since
      hourly is pruned at 30d and daily is built from it — a guild with no daily aggregate
      is skipped entirely), and never let the prune become the next blowout (batched,
      index-served deletes with a per-run budget). The budget is sized against D1's
      **write** cap rather than its read cap — `event_logs` has 7 indexes, so ~8 row-writes
      per deletion; 5,000/night ≈ 40k writes against a ~100k/day allowance. A backlog
      drains over successive nights instead of tripping the cap and taking live logging
      down with it. Long-term history is unaffected: daily aggregates are kept forever at
      ~365 rows/guild/year. Docs: `docs/data-retention.md`.

Taxonomy: the same footgun as 07-27 (a resource trap on a recurring path), plus a new
one — **a fix applied to one of two copies of the same query**, which is why the SQL now
lives in a single module.

#### Orchestrator "27K errors" are phantom (Workflows metrics artifact) — 2026-07-12

`spacebot-ai-orchestrator` shows a ~35% error rate (~27k `scriptThrewException`
over 14 days) in Cloudflare's Workers analytics. **These are not real failures.**
Diagnosed 2026-07-12 via `wrangler tail` + workflow run history:

- Every minute: cron tick `ok` → `CronDispatchWorkflow` `run` RPC invocation
  reports outcome **`exception`** — with an _empty_ `exceptions[]`, no failed
  fetch, and the instance ✅ Completed ~2s later. The dispatch endpoint returns
  200s; retries never fire (`wrangler workflows instances list
spacebot-cron-dispatch` is all green).
- The Workflows engine's internal teardown of each `run()` invocation is what
  the invocation-analytics dataset counts as `scriptThrewException`. At ~1,440
  cron-dispatch runs/day plus superadmin-run / message-purge / sweep workflow
  instances, that's ~1,900–2,700/day ≈ the 27k badge. 27.1k ÷ 77.2k requests =
  the 35.15% shown.
- **Triage rule:** don't chase the analytics error badge for this worker. Real
  health = workflow instance status (`wrangler workflows instances list …`) and
  `console.error` lines in `wrangler tail`, not the invocation outcome counter.

One genuine (small) issue mixed in: CPU p99 is ~**11.4ms** against the free
tier's **10ms** cap, so a thin slice of invocations may be genuinely killed at
the limit. (Analytics `cpuTimeP50/P99` are in **microseconds** — 11,386µs =
11.4ms. The Dashboard app's Cloudflare widget mislabels this as `11386.0ms`;
that display bug is tracked in Dashboard's `planning/` docs, not here.)

- [ ] If phantom errors need to go away (alerting hygiene), options are limited:
      Cloudflare would need to fix the Workflows accounting. A wider dispatch
      cron (e.g. `*/2 * * * *`) halves both the phantom errors and the ~3.2k
      req/day the dispatch chain consumes — the dispatch endpoint dedupes
      per-template-per-minute, so only adopt if superadmin workflow templates
      can tolerate up-to-2-min tick granularity.
- [ ] Workers Paid ($5/mo) raises the CPU cap 10ms → 30s, eliminating the real
      CPU-limit slice (same upgrade already motivated by the account-wide
      request/KV pressure above).

## Community Features

- [x] Public bot invite page
- [x] Server leaderboards
- [x] User profiles and badges
- [x] **Public server browser** (2026-08-02) — an opt-in directory of communities running
      SpaceBot at `/servers`. Admins publish from **Server settings → Public server
      browser**; the switch is **off by default** and nothing is listed until they turn it
      on and supply a headline + Discord invite. Browse page does search / category filter
      / sort / pagination as a plain GET form (works without JS), plus a per-server detail
      page at `/servers/[guildId]`. A guild is only visible when `listed = 1` AND
      `review_status = 'approved'` AND `guild_metadata.fetched_at` is within 7 days
      (`LISTING_FRESHNESS_DAYS`); all three are enforced in SQL in
      `src/lib/db/server-listings.ts`, and an unlisted guild 404s rather than confirming it
      uses SpaceBot. The freshness window, not row existence, is what enforces "the bot is
      still in this server" — nothing deletes `guild_metadata` rows (`runDailyRefresh`
      only upserts for guilds from `getBotGuilds()`), so a plain inner join would have kept
      a server that removed SpaceBot listed forever with a live invite. 7 days against a
      daily refresh tolerates a week of cron/Discord failures before delisting anyone. Invite URLs are allowlisted to `discord.gg` / `discord.com/invite` so
      the directory can't become an open redirector; member counts are gated behind a
      per-server disclosure toggle. Migration 0057→**0059** (`guild_listings`), 19 new
      tests, 390 green. Docs: `docs/server-browser.md`.
- [~] Bot voting and reviews — _(in-app `/vote` page; external listing-site voting/reviews not integrated)_
- [~] Discord server for support — _(in-app `/support` page added; the support Discord server itself is external)_

## Done ✅

- [x] Initialize SvelteKit project
- [x] Configure Cloudflare adapter
- [x] Set up Discord interactions endpoint
- [x] Create basic slash commands
- [x] Implement Discord OAuth
- [x] Create admin dashboard structure
- [x] Add deployment documentation
- [x] Security audit with CodeQL
- [x] AI DM autopilot + Cloudflare Queue orchestrator
- [x] Local runner v2 (typed jobs, VS Code bridge, artifacts)
- [x] Local runner self-healing startup — connects to prod immediately on launch, expands `~` in
      path/workdir env vars, surfaces the real handshake-rejection reason, and auto-negotiates +
      persists a fresh token when the configured one is missing or revoked (`token-store.ts`)
- [x] DM runner orchestration — the DM assistant is grounded on a live runner inventory each turn
      and can queue/inspect/cancel tasks across the user's machines; runner tools pinned to the
      authenticated user (`src/lib/ai/chat.ts`)
- [x] Seamless DM ↔ runner loop — `start_local_runner_task` now **waits** for a single online
      runner and returns real output/exit code in the same turn (no more "queued #N" dead-ends);
      the runner ships a machine-context summary (OS + displays/monitors + hardware + tools +
      memories) in its hello metadata, injected into every `generateChatResponse` turn so the bot
      reasons about the machine and the runner inherits server knowledge — one brain, both contexts.
      Conversational DMs now default to the cloud model: naming a runner ("how many monitors on
      Dirac?") no longer hijacks the turn to the runner's weak local model — only screenshots and the
      explicit "prefer local runner for DMs" preference dispatch there. Both the cloud and local
      prompts forbid closed-book "the text does not specify" refusals about the user's own machine
      (`src/lib/ai/mcp-client.ts`, `src/lib/ai/chat.ts`, `src/routes/api/gateway/dm-runner/+server.ts`,
      `scripts/local-runner/index.ts`, `scripts/local-runner/memory.ts`)
- [x] Runner-side Discord server visibility — new `GET /api/runner/guilds` gives the TUI a
      deterministic, non-LLM `/servers` (`/guilds`) command listing every Discord server SpaceBot
      has data for (superadmins) or the user's managed servers (everyone else), with member/boost
      info from `guild_metadata`; free-form prompts ("what servers do I have") still route through
      `callRunnerAssistant` to the same cloud MCP tools (`list_guilds`, `get_event_logs`, etc.) DMs
      use (`src/routes/api/runner/guilds/+server.ts`, `scripts/local-runner/spacebot-assistant.ts`,
      `scripts/local-runner/tui.tsx`)
- [x] Discord session refresh — the sliding identity cookies used to outlive Discord's 7-day access
      token, leaving users permanently "logged in" with no token: the dashboard rendered "Unknown
      Server" with an all-zero stats shell and `/api/admin/[serverId]/dashboard-stats` answered 401,
      with nothing prompting a re-login. Page navigations now spend the stored refresh token, and a
      session that can't be refreshed is cleared (bounced to `/login?error=session_expired` on
      `/admin` and `/account`, rendered signed-out elsewhere). The dashboard also falls back to
      `guild_metadata` for a guild's name/icon and surfaces a 401 as an explicit
      session-expired banner instead of a convincing all-zero dashboard
      (`src/lib/server/discord-session.ts`, `src/hooks.server.ts`)
- [x] The DM assistant knows what time it is, and whose clock (2026-08-14) — nothing in the system
      prompt said what "now" was or which timezone anyone kept, so "create an event called X on
      September 11th at 9:11PM" made the model invent a year from its training data and write the
      local wall clock into a `Z` timestamp (9:11 PM landed at 2:11 PM for a user in Arizona).
      Every turn now carries the current instant, today's local date, **both** the user's own IANA
      zone and the guild's with their live offsets, and a worked local→UTC conversion. Times are
      read on the **server's** clock when it has one, falling back to the user's own, then to
      asking. Previews render in that zone (they used to say "UTC" on Workers no matter what) and
      the multi-event text parser reads listed times as local instead of building dates in the
      runtime's zone. **The bot never writes a formatted date again:** every event payload ships
      `startTimeDiscord` / `startTimeRelative` / `endTimeDiscord` as Discord `<t:unix:F>` markup,
      which renders on each reader's own clock, and the prompt forbids formatting one by hand.
      Every event message also ends by offering to change the time, name or anything else — true
      after creation too, backed by the new `update_scheduled_event` tool (PATCHes only supplied
      fields; carries the end time along when only the start moves). The user's zone is persisted to
      `users.preferences_json.timezone` (no migration): the dashboard reports the browser's
      detected zone once per change, and the new `update_user_timezone` tool lets someone just tell
      the bot "I'm in Arizona" — pinned to the session user like the runner tools, and it creates
      the `users` row if that DM user has never signed in, so the answer actually survives. When
      **neither** zone is known the scheduled-event tools (`EVENT_TIME_TOOLS`) refuse to run and
      the bot asks rather than assuming UTC — enforced in `executeTool` rather than the prompt,
      and resolved at call time so "I'm in Arizona, now make me an event" works in a single turn.
      Reads aren't gated. Stored zones
      must be `Region/City` or `UTC`; the fixed-offset IANA aliases (`EST`, `MST`, `EST5EDT`) are
      rejected because they don't track DST. Also pins event names as verbatim — the model had been
      shortening "Ammoura.me Launch/Listening Party" to "Ammoura.me Launch Party"
      (`src/lib/ai/time-context.ts`, `src/lib/ai/chat.ts`, `src/lib/ai/mcp-client.ts`,
      `src/routes/api/account/preferences/+server.ts`)
- [x] Superadmin workflow engine + cron dispatch
- [x] Standalone MCP server
- [x] Full JavaScript → TypeScript migration

---

**Note**: This roadmap is a living document and will be updated as priorities change and new features are identified.
