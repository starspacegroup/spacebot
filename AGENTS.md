# Repository Guidelines

## Project Structure & Module Organization

SpaceBot is a SvelteKit app using Bun, Cloudflare Pages/D1, Discord APIs, and auxiliary runtimes. App routes and API endpoints live in `src/routes/`; shared logic lives in `src/lib/`. Tests are in `src/tests/` and follow `*.test.ts` naming. Static assets are in `static/`, migrations in `migrations/`, docs in `docs/`, Pages Functions in `_functions/`, and the standalone MCP package in `mcp-server/`. Treat shared `src/lib/` code as multi-runtime code.

## Build, Test, and Development Commands

Use Bun for all package and script operations.

- `bun install` installs dependencies from `bun.lock`.
- `bun run dev` starts the Vite/SvelteKit dev server.
- `bun run build` installs with the frozen lockfile and builds.
- `bun run typecheck` runs `svelte-check` against `tsconfig.json`.
- `bun run test` runs the Vitest suite.
- `bun run test:coverage` runs coverage with Vitest/V8.
- `bun run test:e2e` runs Playwright tests.
- `bun run db:migrate:local` applies local D1 migrations.

Do not start, stop, or restart dev servers as part of routine changes; note restart requirements in PRs.

## Coding Style & Naming Conventions

Prettier is authoritative: tabs, width 100, single quotes, semicolons, and trailing commas where valid. Run `bun run format` or `bun run format:check`. ESLint uses flat config with TypeScript and Svelte rules; run `bun run lint` before broad changes. Prefer TypeScript for new app code, Svelte components in PascalCase, helpers in camelCase, and route files using SvelteKit conventions such as `+page.svelte`, `+page.server.ts`, and `+server.ts`.

## Testing Guidelines

Add Vitest coverage under `src/tests/` for new logic, especially API handlers, automation rules, security helpers, and database behavior. Name tests by feature or module, for example `local-runner-capabilities.test.ts`. Use `bunx vitest run src/tests/<file>.test.ts` for targeted runs, then run `bun run test` and `bun run typecheck` before review.

## Commit & Pull Request Guidelines

Git history uses Conventional Commit-style prefixes such as `feat(scope): ...`, `fix: ...`, `docs: ...`, `refactor: ...`, and `chore(devx): ...`. Keep commits focused. PRs should explain what changed, why, how it was verified, and any required env vars, migrations, screenshots, or restart notes. Existing `migrations/` files are immutable; add a new sequential migration instead.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local secrets. Never commit credentials. In edge-reachable or shared runtime code, access environment values through the existing `getEnv(name, platform)` helper instead of direct `process.env` assumptions. See `CONTRIBUTING.md`, `README.md`, and `DEPLOYMENT.md` for full setup and deployment details.
