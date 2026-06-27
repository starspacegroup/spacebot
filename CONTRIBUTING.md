# Contributing to SpaceBot

Thanks for your interest in contributing! This guide covers the local setup,
the project's hard rules, and the checks to run before opening a PR.

## Prerequisites

- [Bun](https://bun.sh) 1.3+ — the project's package manager and runtime. Use
  `bun` / `bun run`, **not** npm or node.
- A Discord application and a Cloudflare account for end-to-end work (see
  [README.md](README.md) and [DEPLOYMENT.md](DEPLOYMENT.md)).

## Setup

```bash
bun install
cp .env.example .env        # fill in Discord/Cloudflare credentials
bun run db:migrate:local    # apply migrations to local D1
```

The dev server runs on **`http://localhost:4269`** (pinned in `vite.config.js`).

## Hard rules

These are non-negotiable; PRs that break them will be sent back.

- **Never start, stop, or restart dev servers as part of a change.** Assume the
  dev server is already running on port 4269. If your change needs a restart
  (env vars, `hooks.server.ts`, the gateway), say so in the PR rather than
  scripting it.
- **Migrations in `migrations/` are immutable.** They are already applied to
  production. Never edit or delete an existing migration. For schema changes, add
  a new sequential file (e.g. `migrations/0053_description.sql`) using
  `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE`. Avoid `DROP` without explicit
  approval. `scripts/migrate.ts` records applied files in a `_migrations` table.
- **Use Bun**, not npm/node, for every script and dependency operation.
- **Shared code in `src/lib/` runs in multiple runtimes** (see below). Reach env
  vars through the `getEnv(name, platform)` helper (`platform.env` first, then
  `process.env`) — do not hardcode `process.env` in edge-reachable code.

## The four+ runtimes mental model

The same repo produces code for several cooperating runtimes that share one D1
database. A file's location determines how it reaches env vars and the database —
read [`docs/architecture.md`](docs/architecture.md) and [`CLAUDE.md`](CLAUDE.md)
before changing shared code:

- **SvelteKit edge app** (`src/routes/**`, `src/hooks.server.ts`)
- **Discord gateway bot** (`src/lib/discord/gateway.ts`)
- **AI orchestrator worker** (`orchestrator-worker/`)
- **Local runner** (`scripts/local-runner/`)
- **Pages Functions** (`_functions/`)
- **Standalone MCP server** (`mcp-server/`)

## Running tests and checks

```bash
bun run test                              # full Vitest suite
bunx vitest run src/tests/<file>.test.ts  # a single test file
bunx vitest run -t "<test name>"          # a single test by name
bun run test:coverage                     # coverage (thresholds enforced)
bun run typecheck                         # svelte-check type checking
```

Before opening a PR, make sure `bun run test` and `bun run typecheck` are clean.
Add tests under `src/tests/` for new logic where reasonable.

## Pull request conventions

- Branch off `main`; keep each PR focused on a single change.
- Match the existing code style and the patterns of the surrounding files —
  prefer existing helpers over new abstractions.
- Keep changes scoped; don't revert or churn unrelated code.
- Describe what changed, why, and how you verified it. Call out any required env
  var or server restart.
- Ensure tests and type checks pass locally before requesting review.

For deployment and secret configuration, see [DEPLOYMENT.md](DEPLOYMENT.md).
