---
title: HTTP/3 on Cloudflare
layout: default
---

# HTTP/3 on Cloudflare

HTTP/3 is a Cloudflare zone-level setting, not SvelteKit application code.

## Enable

1. Open the Cloudflare dashboard for the production zone.
2. Go to Speed > Optimization > Protocol Optimization.
3. Enable HTTP/3 (QUIC).

## Verify

```bash
bun run verify:http3 -- https://spacebot.starspace.group
curl --http3 -I https://spacebot.starspace.group
```

The response should succeed and include an `alt-svc` header advertising `h3`.
