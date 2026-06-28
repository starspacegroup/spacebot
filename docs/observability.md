---
title: Observability
layout: default
---

# Observability

## Sentry

Set `SENTRY_DSN` to enable Sentry for client and server runtime errors. Optional values:

- `SENTRY_ENVIRONMENT`
- `SENTRY_TRACES_SAMPLE_RATE`
- `SENTRY_RELEASE`

The repo includes SvelteKit Sentry config files and request timing spans. Without a DSN, spans are logged at debug level.

## APM

`src/lib/server/telemetry.ts` provides OpenTelemetry-compatible span records around request handling and can be extended around DB, gateway, and API hot paths.

## Grafana

Dashboard provisioning examples live in `docs/grafana/`. They are based on existing logs, stats, and health endpoints; no Grafana account is required for repository completion.

## Alerts

Start with alerts for:

- Sentry error rate spikes.
- Cloudflare Pages deploy failures and Worker exceptions.
- Health-check failures for `/api/cron`, Discord interactions, and runner negotiation.

## Dependency Audits

Run `bun run audit:deps` to print Bun audit findings. The script is non-blocking by default so scheduled jobs can archive reports even when upstream toolchain advisories exist. Set `SPACEBOT_AUDIT_STRICT=true` to make findings fail CI.
