# SpaceBot Development Roadmap

This document outlines future enhancements and features. Status reflects what is
actually implemented in the codebase (reconciled 2026-06-18 against a full
feature inventory). Items marked _(partial)_ exist but are not fully wired.

## Priority: High

### Authentication & Authorization

- [x] Implement full Discord OAuth session management — `src/hooks.server.ts`, `src/routes/api/auth/discord/`
- [x] Add Cloudflare KV or D1 storage for user sessions — cookie sessions + D1 user store
- [x] Complete admin authorization logic (check ADMIN_USER_IDS)
- [x] Add logout functionality — `/api/auth/logout`
- [x] Implement session expiration and refresh — configurable sliding session TTL

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
- [x] Create video tutorials — Markdown tutorials with hosted-video placeholders

## Optional Enhancements

### Advanced Features

- [x] Multi-language support (i18n)
- [x] Custom branding per server
- [x] Plugin/extension system — external integrations framework (`docs/integrations.md`)
- [x] Scheduled tasks and cron jobs — superadmin workflows + `scripts/cron.ts` dispatcher
- [x] Webhook integrations — webhooks + GitHub integration

### Monitoring & Observability

- [x] Set up Sentry for error tracking
- [x] Add application performance monitoring (APM)
- [x] Implement structured logging — `src/lib/log.ts` (LOG_LEVEL)
- [x] Create Grafana dashboards
- [x] Set up alerting for critical issues

### Security Enhancements

- [x] Add CSRF protection — same-origin helper for cookie-authenticated JSON mutations
- [x] Implement content security policy (CSP) — report-only HTML CSP from hooks
- [x] Add request signing for webhooks — Discord interaction signature verification
- [x] Set up security headers — HTML response hardening in hooks
- [x] Regular dependency audits and updates

### Performance

- [x] Implement caching strategies — guild cache, AI gateway caching
- [x] Add service worker for offline support
- [x] Optimize images and assets
- [x] Enable HTTP/3 on Cloudflare
- [x] Add CDN for static assets — Cloudflare edge

## Community Features

- [x] Public bot invite page
- [x] Server leaderboards
- [x] User profiles and badges
- [x] Bot voting and reviews
- [x] Discord server for support

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
- [x] Superadmin workflow engine + cron dispatch
- [x] Standalone MCP server
- [x] Full JavaScript → TypeScript migration

---

**Note**: This roadmap is a living document and will be updated as priorities change and new features are identified.
