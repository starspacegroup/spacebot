---
title: Grafana Dashboard Assets
layout: default
---

# Grafana Dashboard Assets

Import `spacebot-dashboard.json` into Grafana and connect it to metrics generated from SpaceBot logs/stats exports.

Suggested data sources:

- Cloudflare Logs or Logpush for HTTP and Worker telemetry.
- Sentry metrics for error rate and transaction timing.
- A scheduled exporter that converts `/api/v1/stats` and gateway benchmark history into Prometheus metrics.
