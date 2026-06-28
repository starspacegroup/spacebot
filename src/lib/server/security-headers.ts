/**
 * Security response headers for the SvelteKit edge app.
 *
 * These are applied in `src/hooks.server.ts` to HTML document responses only
 * (see `applySecurityHeaders`). They are intentionally NOT applied to API JSON,
 * static assets, or the runner WebSocket upgrade (a 101 response), because
 * mutating headers on those is either pointless or risks disturbing the upgrade.
 *
 * Note on CSP: SvelteKit's `kit.csp` (nonce/hash injection) lives in
 * `svelte.config.js`, which is outside this domain's editable file set, so CSP
 * is delivered here from hooks instead. It ships in **Report-Only** mode by
 * default: the policy cannot be browser-verified without a dev-server restart
 * (a hard project rule), so enforcing it blind could break the SPA. The real,
 * enforced clickjacking protection is `X-Frame-Options: DENY` plus the CSP
 * `frame-ancestors 'none'` directive (which IS honored even in report-only as a
 * documented intent). Flip `cspReportOnly` to `false` once the policy is
 * validated in a browser.
 */

/** Static security headers applied to HTML responses. */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Deny powerful features by default; opt back in per-feature if ever needed.
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()",
};

/**
 * Build the Content-Security-Policy string.
 *
 * Permissive-but-real: `'unsafe-inline'` is allowed for scripts/styles because
 * SvelteKit injects inline hydration scripts and Svelte injects inline styles,
 * and we cannot hash them from here without `kit.csp`. `frame-ancestors 'none'`
 * and `object-src 'none'` are the meaningful hardening directives.
 */
export function buildContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "form-action 'self' https://discord.com",
  ].join("; ");
}

/** True when the response is an HTML document (the only target for these headers). */
export function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("text/html");
}

/**
 * Apply security headers to an HTML response in place. No-op for non-HTML
 * responses (API JSON, assets, WebSocket upgrades), which keeps us clear of the
 * runner WebSocket 101 upgrade. Existing headers are never clobbered.
 *
 * @returns the same `response` for convenient chaining.
 */
export function applySecurityHeaders(
  response: Response,
  options: { cspReportOnly?: boolean } = {},
): Response {
  if (!isHtmlResponse(response)) return response;

  const { cspReportOnly = true } = options;

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) {
      response.headers.set(name, value);
    }
  }

  const cspHeader = cspReportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
  if (!response.headers.has(cspHeader)) {
    response.headers.set(cspHeader, buildContentSecurityPolicy());
  }

  return response;
}
