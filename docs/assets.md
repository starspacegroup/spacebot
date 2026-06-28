# Asset Optimization

Source PNG/JPG assets are kept when they are canonical screenshots or icons. Optimized WebP variants should be used by app surfaces where available.

Run:

```bash
bun run images:check
```

The check fails on large PNG/JPG assets that should be converted to WebP/AVIF or explicitly documented before shipping.
