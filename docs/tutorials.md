# SpaceBot Tutorials

Hosted video links can be added later; the Markdown guides below are the source of truth today.

## Getting Started

1. Copy `.env.example` to `.env`.
2. Run `bun install`.
3. Apply local D1 migrations with `bun run db:migrate:local`.
4. Start the dev server in your own terminal with `bun run dev`.

## Discord App Setup

Create a Discord application, add a bot, copy the client ID, bot token, and public key into `.env`, then run `bun run register-commands`.

## First Automation

Open a server dashboard, create an automation, choose an event trigger, add actions, and test it from Discord.

## Local Runner

See `docs/local-runner-v2.md` for pairing, typed jobs, VS Code bridge setup, and artifacts.

## AI Autopilot

See `docs/ai-autopilot.md` for provider configuration, retry policy, and DM autopilot behavior.

## Production Deploy

See `DEPLOYMENT.md` for Cloudflare Pages/D1 deployment, environment variables, and operational checks.
