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
- [x] Implement session expiration and refresh — configurable sliding session TTL _(note: OAuth access-token refresh not implemented)_

### Discord Bot Features

- [x] Add more slash commands — custom command system (`src/lib/db/commands.ts`)
- [x] Implement message context menu commands — message context menu registration + routing
- [x] Add user context menu commands
- [x] Create button and select menu interactions — `src/lib/db/button-actions.ts`
- [x] Add modal (form) interactions — automation action system
- [x] Implement command permission controls — server-side command permission enforcement

### Database & Persistence

- [x] Set up Cloudflare D1 database — `wrangler.toml`
- [x] Create schema for server settings, user data, bot statistics, command usage logs — 52 migrations
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

- [x] Set up Vitest for unit tests — 94 tests across 28 files
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
- [x] Scheduled tasks and cron jobs — superadmin workflows on Cloudflare Cron Triggers + Workflows (PM2 tick retired to deploy-poll only)
- [x] Durable workflow execution — per-run Cloudflare Workflow instances (queue-driven advance loop, approval gates, timed steps, retry/backoff, watchdog)
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

## Community Features

- [x] Public bot invite page
- [x] Server leaderboards
- [x] User profiles and badges
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
      the runner ships a compact machine-context summary (system facts + tools + memories) in its
      hello metadata, injected into every `generateChatResponse` turn so the bot reasons about the
      machine and the runner inherits server knowledge — one brain, both contexts, across all DM
      routing modes (`src/lib/ai/mcp-client.ts`, `src/lib/ai/chat.ts`, `scripts/local-runner/index.ts`)
- [x] Superadmin workflow engine + cron dispatch
- [x] Standalone MCP server
- [x] Full JavaScript → TypeScript migration

---

**Note**: This roadmap is a living document and will be updated as priorities change and new features are identified.
