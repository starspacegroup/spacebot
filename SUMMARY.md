# SpaceBot — Project Summary

SpaceBot is a self-hosted Discord bot platform: a **SvelteKit 2 / Svelte 5** web
dashboard plus Discord integration, deployed on **Cloudflare Pages** and backed by
**Cloudflare D1** (SQLite). It is not a single process — several cooperating runtimes
share one database (see [`docs/architecture.md`](docs/architecture.md)).

## Runtimes

| Runtime                                 | Entry                                  | Env            | DB                              |
| --------------------------------------- | -------------------------------------- | -------------- | ------------------------------- |
| SvelteKit edge app (Pages/Workers)      | `src/routes/**`, `src/hooks.server.ts` | `platform.env` | D1 binding                      |
| Discord gateway bot (Bun/Node)          | `src/lib/discord/gateway.ts`           | `process.env`  | `bun:sqlite` / `better-sqlite3` |
| AI orchestrator worker (Queue consumer) | `orchestrator-worker/src/`             | Worker `env`   | calls back into Pages API       |
| Local runner (user CLI)                 | `scripts/local-runner/`                | `process.env`  | none (WebSocket to server)      |
| Pages Functions                         | `_functions/`                          | Pages `env`    | D1                              |
| Standalone MCP server                   | `mcp-server/`                          | `process.env`  | Cloudflare API / local SQLite   |

Shared `src/lib/` code reaches env via the `getEnv(name, platform)` helper so it works
in both the edge app and the Node gateway.

## Capabilities

- **Discord bot:** custom slash commands, message & user context-menu commands,
  button/select/modal interactions, signature-verified interactions endpoint, gateway
  event capture, AI DM autopilot.
- **Automation engine:** event → action rules (send message, kick/ban/timeout, roles,
  DM, webhook, scheduled message) with template variables.
- **Dashboard:** per-server admin (automations, commands, logs, stats, settings,
  branding), account area (AI jobs, workflows), superadmin (users, servers, workflows).
- **AI:** Workers AI / Cloudflare AI Gateway in production; optional local Ollama
  (`AI_PROVIDER=ollama`, default `gemma3:4b`) in dev.
- **Local runner v2:** typed jobs over WebSocket, path allowlist, TUI, VS Code bridge.
- **Superadmin workflows:** cron-dispatched workflow engine.
- **Security:** Discord OAuth2 + admin gating, request signature verification, response
  security headers + CSP (report-only), CSRF same-origin helper, sliding session TTL,
  API rate limiting (exempts interactions + runner WS).

## Tooling & quality

- **Bun** for all package/runtime management.
- **TypeScript** throughout (`src/`, `scripts/`, `mcp-server/`, `orchestrator-worker/`).
- **Tests:** Vitest (`bun run test`), coverage thresholds enforced (`bun run test:coverage`),
  Playwright e2e scaffold (`bun run test:e2e`).
- **Lint/format:** ESLint (flat config) + Prettier, husky + lint-staged pre-commit.
- **CI:** GitHub Actions — typecheck/test/lint on push & PR; orchestrator-worker auto-deploy;
  docs published to GitHub Pages from [`docs/`](docs/).

## Commands

```bash
bun install
bun run dev                # SvelteKit dev server on :4269
bun run dev:gateway        # Discord gateway bot (separate terminal)
bun run build              # production build → .svelte-kit/cloudflare
bun run db:migrate:local   # apply migrations to local D1
bun run test               # vitest
bun run typecheck          # svelte-check
bun run lint               # eslint
```

## Documentation

Full docs are published to **GitHub Pages** and live in [`docs/`](docs/):
architecture, API, integrations, AI autopilot, local runner, superadmin workflows,
observability, alerting, HTTP/3, and tutorials. See also [`README.md`](README.md),
[`DEPLOYMENT.md`](DEPLOYMENT.md), [`ROADMAP.md`](ROADMAP.md), and
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Status

Roadmap features are largely implemented; items requiring external infrastructure
(Sentry/APM/Grafana/alerting), full i18n translation, HTTP/3 enablement, and a few
community surfaces are tracked as scaffold/external in [`ROADMAP.md`](ROADMAP.md) and
are intentionally not claimed as fully wired.
