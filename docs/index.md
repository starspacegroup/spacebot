---
title: SpaceBot Documentation
layout: default
---

# SpaceBot Documentation

SpaceBot is a self-hosted Discord bot platform: a **SvelteKit 2 / Svelte 5** web
dashboard plus Discord integration, deployed on **Cloudflare Pages** and backed by
**Cloudflare D1** (SQLite). It runs as several cooperating runtimes that share one
database — see the architecture overview below.

> Source: [github.com/starspacegroup/spacebot](https://github.com/starspacegroup/spacebot) ·
> Project [README](https://github.com/starspacegroup/spacebot/blob/main/README.md) ·
> [Contributing](https://github.com/starspacegroup/spacebot/blob/main/CONTRIBUTING.md)

## Start here

- [Architecture](architecture.md) — the four+ runtimes and the request → event → automation flow
- [API reference](api.md) — REST endpoints and authentication
- [Integrations](integrations.md) — external integration protocol

## Features & subsystems

- [AI Autopilot](ai-autopilot.md) — DM autopilot via Cloudflare Queues + the orchestrator worker
- [Local Runner v2](local-runner-v2.md) — typed jobs, VS Code bridge, artifacts
- [Superadmin Workflows](superadmin-workflows.md) — scheduled workflow engine + cron dispatch
- [Server Browser](server-browser.md) — the opt-in public directory at `/servers`

## Operations

- [Data retention](data-retention.md) — what is kept forever, what is pruned, and why
- [Observability](observability.md) — structured logging and telemetry
- [Alerting](alerts.md) — alert routing for critical issues
- [Grafana dashboards](grafana/README.md) — dashboard assets
- [HTTP/3 on Cloudflare](http3.md) — enabling and verifying HTTP/3
- [Asset optimization](assets.md) — image/asset audit

## Guides

- [Tutorials](tutorials.md) — walkthroughs and how-tos

---

_These docs are rendered on the main site at
[spacebot.starspace.group/docs/dev](https://spacebot.starspace.group/docs/dev),
built at deploy time from this `docs/` folder._
