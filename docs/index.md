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
- [Game](game.md) — the hidden-agent round for a voice channel, played in the Activity
- [Command sync](command-sync.md) — slash commands reach Discord by themselves after a deploy
- [Command access](command-access.md) — permission levels plus role rules for who can run a command
- [The /help command](help-command.md) — what every member sees when they ask what the bot does
- [Member Rooms](managed-channels.md) — self-service channels members create, run and outlive
- [Statistics](stats.md) — the admin Statistics page: its four tabs, and the Voice tab that replaced the VC activity page
- [Timebox](timebox.md) — focus and break timers, alone or for a voice channel, with an optional self-deafen
- [Activity](activity.md) — SpaceBot as a Discord Activity: sign-in, where it runs, and the module switch
- [Quorum](quorum.md) — one-command yes/no decisions that close themselves and post an owned result
- [Automation time windows](automation-time-windows.md) — fire an automation only inside (or outside) hours and weekdays
- [Voice channel threshold trigger](automation-voice-threshold.md) — fire an automation once when a voice channel reaches N people
- [Oldest](oldest.md) — `/oldest`: who has been on Discord, or in the server, the longest
- [Member content](member-content.md) — `/about`: a role-gated piece of content each member sets and clears, read by the bot and `GET /api/v1/member-content`

- [Observances](observances.md) — a historical day posted as it happened, on its anniversary
- [Durable message purge](message-purge.md) — deleting a user's messages across every channel in bounded batches that fit the request limit
- [Dirac interface plan](dirac-interface-plan.md) — plan, not implemented: SpaceBot as an interface to Dirac

## Operations

- [Secrets](secrets.md) — where secrets really come from (environment fallback vs Secret Manager)
- [Querying production](production-queries.md) — read-only `bun run db:query` against production D1
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
