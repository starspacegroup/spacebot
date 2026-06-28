/**
 * Same-origin / CSRF helpers for cookie-authenticated JSON API routes.
 *
 * Context: SvelteKit ships with `kit.csrf.checkOrigin` enabled by default
 * (we don't disable it in `svelte.config.js`), which already rejects
 * cross-origin form-encoded / multipart / text-plain POSTs. That covers HTML
 * form submissions. It does NOT, however, guard state-changing endpoints that
 * accept `application/json` and rely solely on the session cookie.
 *
 * This module provides an explicit, opt-in `Origin`-header check for those
 * routes. It is intentionally NOT wired into `hooks.server.ts` globally:
 *
 *   - The Discord interactions endpoint (`/api/discord/interactions`) is
 *     authenticated by request signature, not cookies — it must NOT use this.
 *   - The AI autopilot callbacks (`AI_AUTOPILOT_INTERNAL_KEY`) and the runner
 *     WebSocket are token-authenticated — they must NOT use this either.
 *
 * Sharp edges for callers:
 *   - A request with no/unparseable `Origin` header returns `false`. Same-origin
 *     fetch() calls from the dashboard always send `Origin`, so this only rejects
 *     non-browser or cross-origin callers. Use it only on browser, cookie-authed
 *     mutation routes — never on token/signature-authed machine endpoints.
 *   - Add extra trusted origins (e.g. a tunnel host) via `TRUSTED_ORIGINS`
 *     (comma-separated) and pass them through `allowedOrigins`.
 */

/** Normalize a URL/origin string to its bare origin, or `null` if unparseable. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Pure same-origin check. Returns `true` only when the request's `Origin`
 * header matches `requestOrigin` or one of `allowedOrigins`.
 */
export function isSameOrigin(params: {
  originHeader: string | null | undefined;
  requestOrigin: string;
  allowedOrigins?: Array<string | null | undefined>;
}): boolean {
  const { originHeader, requestOrigin, allowedOrigins = [] } = params;

  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;

  const target = normalizeOrigin(requestOrigin);
  if (target && origin === target) return true;

  for (const allowed of allowedOrigins) {
    const normalized = normalizeOrigin(allowed);
    if (normalized && origin === normalized) return true;
  }

  return false;
}

/** Parse a comma-separated `TRUSTED_ORIGINS` value into normalized origins. */
export function parseTrustedOrigins(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => normalizeOrigin(entry.trim()))
    .filter((origin): origin is string => Boolean(origin));
}

/**
 * Convenience wrapper for a SvelteKit `RequestEvent`-like object. Compares the
 * request's `Origin` header against `event.url.origin` plus any configured
 * `TRUSTED_ORIGINS`. Returns `true` when the request is same-origin (safe).
 *
 * Example (inside a JSON POST handler):
 *   if (!isSameOriginRequest(event)) {
 *     return json({ error: "Cross-origin request rejected" }, { status: 403 });
 *   }
 */
export function isSameOriginRequest(
  event: {
    request: { headers: { get(name: string): string | null } };
    url: { origin: string };
    platform?: { env?: Record<string, unknown> } | null;
  },
  options: { allowedOrigins?: string[] } = {},
): boolean {
  const envTrusted = parseTrustedOrigins(
    (event.platform?.env?.TRUSTED_ORIGINS as string | undefined) ??
      (typeof process !== "undefined" ? process.env?.TRUSTED_ORIGINS : undefined),
  );

  return isSameOrigin({
    originHeader: event.request.headers.get("origin"),
    requestOrigin: event.url.origin,
    allowedOrigins: [...envTrusted, ...(options.allowedOrigins ?? [])],
  });
}
