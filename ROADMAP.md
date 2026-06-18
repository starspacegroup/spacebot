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
- [ ] Implement session expiration and refresh — no explicit TTL/refresh yet

### Discord Bot Features
- [x] Add more slash commands — custom command system (`src/lib/db/commands.ts`)
- [ ] Implement message context menu commands
- [ ] Add user context menu commands
- [x] Create button and select menu interactions — `src/lib/db/button-actions.ts`
- [x] Add modal (form) interactions — automation action system
- [ ] Implement command permission controls — _(partial: permission fields exist, enforcement incomplete)_

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
- [ ] Bot configuration editor — _(partial: settings page exists; persistence being completed)_
- [x] Audit log viewer — event logs + user activity

### Bot Statistics
- [x] Track command usage per server
- [x] Track active users and servers
- [x] Calculate uptime and latency metrics — gateway benchmarks
- [x] Store historical data for trends — stats aggregation (hourly/daily)
- [ ] Export statistics as reports

### API Endpoints
- [x] Create REST API for bot stats — `/api/stats/`, `/api/v1/`
- [x] Add webhook endpoints for external services — `/api/webhooks/`, GitHub integration
- [ ] Implement rate limiting on API endpoints
- [x] Add API authentication tokens — API keys + integration tokens

## Priority: Low

### Frontend Improvements
- [x] Add dark mode toggle — `src/lib/theme.svelte.ts`
- [ ] Improve responsive design for mobile
- [ ] Add loading states and skeletons
- [ ] Implement error boundaries
- [ ] Add toast notifications
- [ ] Create animated transitions

### Developer Experience
- [x] Add TypeScript support — full JS→TS migration (all `src/` + `scripts/` are `.ts`, components `<script lang="ts">`, `bun run typecheck` via svelte-check)
- [ ] Set up ESLint and Prettier
- [ ] Add pre-commit hooks with Husky
- [ ] Create component library/design system
- [ ] Add Storybook for component documentation

### Testing
- [x] Set up Vitest for unit tests — 94 tests across 28 files
- [ ] Add Playwright for e2e tests
- [x] Create test coverage reports — `bun run test:coverage` (v8)
- [ ] Add CI/CD testing pipeline
- [x] Mock Discord API for testing — vi.mock in test suite

### Documentation
- [ ] Add inline code documentation (JSDoc)
- [ ] Create API documentation
- [ ] Add architecture diagrams
- [ ] Write contributing guidelines
- [ ] Create video tutorials

## Optional Enhancements

### Advanced Features
- [ ] Multi-language support (i18n)
- [ ] Custom branding per server
- [x] Plugin/extension system — external integrations framework (`docs/integrations.md`)
- [x] Scheduled tasks and cron jobs — superadmin workflows + `scripts/cron.ts` dispatcher
- [x] Webhook integrations — webhooks + GitHub integration

### Monitoring & Observability
- [ ] Set up Sentry for error tracking
- [ ] Add application performance monitoring (APM)
- [x] Implement structured logging — `src/lib/log.ts` (LOG_LEVEL)
- [ ] Create Grafana dashboards
- [ ] Set up alerting for critical issues

### Security Enhancements
- [ ] Add CSRF protection
- [ ] Implement content security policy (CSP)
- [x] Add request signing for webhooks — Discord interaction signature verification
- [ ] Set up security headers
- [ ] Regular dependency audits and updates

### Performance
- [x] Implement caching strategies — guild cache, AI gateway caching
- [ ] Add service worker for offline support
- [ ] Optimize images and assets
- [ ] Enable HTTP/3 on Cloudflare
- [x] Add CDN for static assets — Cloudflare edge

## Community Features

- [ ] Public bot invite page
- [ ] Server leaderboards — _(partial: voice leaderboard stats exist)_
- [ ] User profiles and badges
- [ ] Bot voting and reviews
- [ ] Discord server for support

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
