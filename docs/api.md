---
title: SpaceBot API
layout: default
---

# SpaceBot API

The stable external API lives under `/api/v1/*` and uses `Authorization: Bearer sb_live_...` API keys.

The machine-readable OpenAPI document is available at `/api/openapi.json` and can be regenerated into `docs/generated/openapi.json` with:

```bash
bun run docs:api
```

## Error Shape

Errors return JSON with a top-level `error` string. Rate-limited requests return HTTP 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

## Endpoints

- `GET /api/v1/stats?days=30` requires `stats:read`.
- `GET /api/v1/stats/members?period=30d&granularity=auto` requires `stats:read`.
  The member-count series for a graph: one point per bucket, each the last
  `server_stats` snapshot in that bucket, with `member_count`, `online_count`,
  `human_count` and `recorded_at`. `period` is `24h`, `<N>d`, `1y` or `all`;
  `granularity` is `auto` (hourly to 2 days, daily to 60, weekly beyond),
  `hourly`, `daily` or `weekly`. Anything else is a 400 rather than a silent
  fallback. Retention keeps 90 days of snapshots, so longer periods return what
  remains.
- `GET /api/v1/settings` requires `settings:read`.
- `GET /api/v1/commands` requires `commands:read`.
- `GET /api/v1/automations` requires `automations:read`.
- `GET /api/v1/integrations/status` reads integration status.
- `GET /api/stats/:guildId/export?format=json|csv` exports admin-authenticated report data.

## Integrations

Discord signed interactions at `/api/discord/interactions` are signature-verified and exempt from app rate limits. Runner WebSocket upgrade paths are also exempt.
