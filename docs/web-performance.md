# Web performance and security headers

How the public pages are measured, what was found on 2026-11-17, and how to check again.

## Measuring

- **Lighthouse (mobile, simulated slow 4G):**
  `CHROME_PATH=/usr/bin/google-chrome-stable bunx lighthouse https://spacebot.starspace.group/ --only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless=new --no-sandbox"`
- **Mozilla Observatory (headers):** `curl -s -X POST "https://observatory-api.mdn.mozilla.net/api/v2/scan?host=spacebot.starspace.group"`
  then `curl -s "https://observatory-api.mdn.mozilla.net/api/v2/analyze?host=spacebot.starspace.group"` for each test.
- **Layout shift per page:** a `PerformanceObserver` for `layout-shift` in headless Chrome, which names
  the elements that moved. Lighthouse's own "layout shifts" audit gives the same.

## What was found, and what changed

| Finding                                               | Cause                                                                                                                                     | Change                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout shift 0.17 to 0.24 on every page               | The header's Pricing link and Login button appeared only after hydration (`hasInitialized`), so the header grew and pushed the page down. | `showLoginButton` comes from the server data, so the first paint is complete. Shift is now 0.                                                                                                                                  |
| Home LCP 4.8 s                                        | The hero is a 288 KB animated WebP, and both the light and dark copy were downloaded (CSS hides one; hidden images still download).       | One `<picture>` chosen by theme, three widths (640, 1100, 1680), `fetchpriority="high"`, width and height set. The site's own theme setting overrides the operating system's (`followTheme`).                                  |
| Logo 960 px shown at 28 to 64 px                      | One 32 KB file everywhere                                                                                                                 | `logo-64.webp` and `logo-128.webp` for the header, hero and the how-it-works scenes.                                                                                                                                           |
| Google Analytics blocking the first load              | Loaded with `async` in the head                                                                                                           | Queued at once, downloaded on `load` when the browser is idle.                                                                                                                                                                 |
| Contrast failures                                     | Muted text at 50% lightness (4.4:1); the dimmed pricing card used opacity; bright status greens and ambers as text                        | Muted text at 42%; no opacity on the coming-soon card; `--color-success-text`, `--color-warning-text`, `--color-danger-text` for text.                                                                                         |
| Language button name did not contain its visible text | `aria-label="Language"` on a button reading "EN"                                                                                          | `aria-label="Language: EN"`                                                                                                                                                                                                    |
| Footer link told apart only by colour                 | `text-decoration: none`                                                                                                                   | Underlined.                                                                                                                                                                                                                    |
| Server cards skipped a heading level                  | `h3` under the page's `h1`                                                                                                                | `h2`.                                                                                                                                                                                                                          |
| `/support` had no meta description                    | Only some pages wrote one                                                                                                                 | `SocialMeta` writes it for pages that do not write their own (`ownDescription` in `src/lib/seo/social.ts`).                                                                                                                    |
| Back/forward cache blocked                            | `Cache-Control: no-store` on every page                                                                                                   | Signed-out visitors on public pages get `private, no-cache` (always revalidated, never in a shared cache, but kept for the back button). A request carrying a session cookie, any other page and any non-GET stays `no-store`. |

## Security headers (Observatory)

- **HSTS** is sent on pages: `max-age=31536000`, without `includeSubDomains` or `preload`. Browsers that
  have seen it will refuse plain http for the host for a year.
- **Content-Security-Policy** is **enforced on the public pages** (`isPublicMarketingPath` in
  `src/lib/server/security-headers.ts`) and still report-only everywhere else (dashboard, account, the
  Activity), because those need trying with a signed-in session first. The policy now allows the two
  analytics scripts (`www.googletagmanager.com`, `static.cloudflareinsights.com`); as a report-only policy
  it had been flagging both, so enforcing the old one would have broken analytics.
- It still allows `'unsafe-inline'` for scripts and styles, because SvelteKit and `app.html` use inline
  scripts and Svelte uses inline styles. Removing it means SvelteKit's `csp` option (nonces or hashes).
- **Subresource Integrity** still reports as not implemented. The one external script is Google's tag,
  whose content changes, so it cannot carry an integrity hash.

## Checking a change

After a deploy, re-run Lighthouse on `/`, `/status`, `/servers`, `/docs`, `/support` and `/privacy`, and
the Observatory scan. If a script or image stops loading on a public page, look for a CSP violation in
the browser console first: the policy is enforced there.
