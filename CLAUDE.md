# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SpaceBot is a self-hosted Discord bot platform: a **SvelteKit 2 / Svelte 5** web dashboard + Discord
integration deployed on **Cloudflare Pages**, backed by **Cloudflare D1** (SQLite). It is _not_ a single
process — it is several cooperating runtimes that share one D1 database (see Architecture).

## Hard rules (from `.github/copilot-instructions.md`)

- **The dev server is always at `http://localhost:4269`** (also tunneled at `https://spacebot-dev.starspace.group`).
  Use port **4269** when driving a browser, not the SvelteKit default 5173. (`vite.config.js` pins `server.port = 4269`.)
- **Migrations in `migrations/` are immutable.** They are already applied to production. Never edit an
  existing migration. Add a new sequential file (e.g. `0053_description.sql`) with `ALTER TABLE` /
  `CREATE TABLE IF NOT EXISTS`. Avoid `DROP` without explicit user approval. `scripts/migrate.ts` records
  applied files in a `_migrations` table and skips them forever after.
- Use **Bun** (`bun install`, `bun run <script>`), not npm/node, per project convention.

## Commands

```bash
bun install                    # deps (build uses --frozen-lockfile)
bun run dev                    # SvelteKit dev server on :4269 (VITE_HMR=true)
bun run dev:wrangler           # run against the real Cloudflare local runtime (Wrangler, :4269)
bun run dev:gateway            # start the Discord gateway bot process (separate terminal)
bun run build                  # production build → .svelte-kit/cloudflare
bun run db:migrate:local       # apply migrations to local D1 (test here before prod)
bun run db:migrate             # apply migrations to production D1
bun run register-commands      # sync slash commands to Discord
bun run test                   # vitest run (tests in src/tests/*.test.ts)
bun run test:watch             # vitest watch
bun run test:coverage          # vitest with v8 coverage (thresholds enforced — see vite.config.js)
```

Run a single test: `bunx vitest run src/tests/<file>.test.ts` or `bunx vitest run -t "<test name>"`.

Production gateway process management uses PM2 (`bun run gateway`, `gateway:restart`, `gateway:logs`,
`gateway:status`) via `ecosystem.config.cjs`.

## Architecture — which runtime runs what

This is the key mental model. The same repo produces code for **four+ distinct runtimes**, and a file's
runtime determines how it reaches env vars and the database:

| Runtime                                           | Entry                                  | Env access                          | DB access                             |
| ------------------------------------------------- | -------------------------------------- | ----------------------------------- | ------------------------------------- |
| **SvelteKit edge app** (Cloudflare Workers/Pages) | `src/routes/**`, `src/hooks.server.ts` | `platform.env.X`                    | D1 binding `platform.env.DB`          |
| **Discord gateway bot** (long-running Bun/Node)   | `src/lib/discord/gateway.ts`           | `process.env.X` (+ `loadSecrets()`) | `bun:sqlite` / `better-sqlite3`       |
| **AI orchestrator worker** (Queue consumer)       | `orchestrator-worker/src/`             | Worker `env`                        | calls back into Pages API             |
| **Local runner** (user machine CLI)               | `scripts/local-runner/index.ts`        | `process.env`                       | none — talks to server over WebSocket |
| **Pages Functions**                               | `_functions/`                          | Pages `env`                         | D1                                    |
| **Standalone MCP server**                         | `mcp-server/index.js`                  | `process.env`                       | Cloudflare API / local SQLite         |

Because code in `src/lib/` is imported by _both_ the edge app and the Node gateway, env access goes through
the `getEnv(name, platform)` helper (Workers `platform.env` first, then `process.env`). When adding shared
code, support both. `vite.config.js`'s `excludeNativeModules` plugin stubs `better-sqlite3` at build time so
the Node-only SQLite path doesn't break the Workers bundle (`src/lib/ai/mcp-client.ts` is the dynamic importer).

### Request → event → automation flow

1. **Discord interactions** (slash commands, buttons) hit `POST /api/discord/interactions` on the edge app,
   signature-verified via `discord-interactions`.
2. **Live Discord events** (joins, messages, voice, etc.) are captured by the **gateway bot** (`discord.js`
   client), logged to D1 via `src/lib/db/logger.ts`, and fed into the **automation engine**
   (`src/lib/automation/engine.ts`).
3. The **automation engine** matches stored triggers to events and runs actions (send message, kick/ban,
   add role, DM, webhook, scheduled message). Template variables like `{user.mention}` are resolved here.
4. **AI DM autopilot**: when `DM_AUTOPILOT_ENABLED=true`, gateway DMs enqueue jobs onto the
   `AI_AUTOPILOT_QUEUE` Cloudflare Queue; the `orchestrator-worker` consumes them and calls back into
   `POST /api/ai/jobs/execute` / `/sweep` (secured by `AI_AUTOPILOT_INTERNAL_KEY`). See `docs/ai-autopilot.md`.

### Code layout (`src/lib/`)

- `discord/` — gateway client, REST client, bot registry (`bots.ts`), command registration, event metadata.
- `automation/engine.ts` — the event→action evaluation core.
- `db/` — one module per table/domain (`logger.ts`, `automations.ts`, `commands.ts`, `ai-orchestration.ts`,
  `local-runners.ts`, `workflows.ts`, …). All D1/SQLite access goes through here.
- `ai/` — `chat.ts` (Workers AI / Cloudflare AI Gateway in production; routes to a local Ollama model when `AI_PROVIDER=ollama` is set in local `.env` — dev only, default `gemma3:4b`), `mcp-client.ts`, `retry-policy.ts`.
- `server/` — server-only helpers (cron matching, superadmin workflow runtime, voice logging).
- `integrations/` — external integrations (GitHub) + registry/auth.

`src/routes/` is split into `admin/` (per-server dashboard under `[serverId]/`), `account/` (user-level
AI jobs/workflows/operations), and `api/` (REST endpoints, plus `api/v1/` and `api/runner/ws` WebSocket).

### Local runner subsystem

`scripts/local-runner/` is a standalone Bun CLI users install on their own machines (`bun run runner`).
It connects to the server over WebSocket (`/api/runner/ws`), receives jobs, runs them as local shell
commands inside a path allowlist (`RUNNER_ALLOWED_PATHS` / `~/.config/spacebot/permissions.json`), and
streams results back. It has a TUI (`tui.tsx`, OpenTUI/React), a VS Code bridge
(`local-runner-vscode-bridge/`), and pluggable AI providers (Ollama, Copilot). See `docs/local-runner-v2.md`.

## Scheduling

Cloudflare Pages does **not** support cron triggers, but `orchestrator-worker` (a plain Cloudflare
Worker) does. Its Cron Trigger (`* * * * *`) runs `CronDispatchWorkflow`, which durably POSTs
`/api/superadmin/workflows/dispatch`; due runs are created `queued` and enqueued onto the
`spacebot-workflow-runs` queue, where the worker creates one durable `SuperadminRunWorkflow`
instance per run (instance id `sa-run-<runId>`). That instance drives the run by looping the
idempotent `runs/:id/advance` endpoint — graph logic stays in Pages
(`src/lib/server/superadmin-workflow-advance.ts`); the Workflow just turns wait instructions into
`step.sleep` / `step.waitForEvent` (approval gates). A second Cron Trigger (`*/5 * * * *`) enqueues
the AI autopilot watchdog sweep. Everything is provisioned via `wrangler deploy` (plus a one-time
`wrangler queues create spacebot-workflow-runs`). `scripts/cron.ts` (PM2) is deploy-poll only —
the dispatcher tick was removed. Workflow templates are **versioned**: every definition change
snapshots into `superadmin_workflow_template_versions` and can be reverted from the UI. Schedules
live as `cron_expression` in D1, managed under Admin → Superadmin → Workflows
(`docs/superadmin-workflows.md`), not in config files. In vite dev (or with
`WORKFLOW_DURABLE_EXECUTION=false`), runs execute inline instead of via the queue.

## Auth model

Discord OAuth2 sets cookies (`discord_user_id`, etc.); admin access is gated on Discord server-admin
permissions, with `ADMIN_USER_IDS` granting global superadmin. In dev only, `DEV_AUTH_BYPASS=true` enables
`/dev-login?role=user|admin|superadmin` (handled in `hooks.server.ts`) — these routes 404 in production builds.

A session has two halves with different clocks: the identity cookies (ours, slid forward on every
page navigation) and Discord's access token (7 days). `src/lib/server/discord-session.ts` keeps them
in step — page navigations refresh the token, and a session that can't be refreshed is **cleared**,
never left half-authenticated. Don't add code paths that treat a missing access token as a soft
failure: that produced a dashboard of plausible zeros for anyone whose token lapsed.

## Further docs

`README.md` (features/setup), `DEPLOYMENT.md` (Cloudflare Pages deploy + secrets), `ROADMAP.md`, and the
`docs/` folder (`ai-autopilot.md`, `local-runner-v2.md`, `superadmin-workflows.md`, `integrations.md`).
