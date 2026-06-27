/**
 * Session cookie lifetime configuration.
 *
 * The Discord session is gated on the `discord_user_id` cookie. Historically
 * every auth cookie was hardcoded to a 7-day `maxAge`. This module centralizes
 * that value, makes it configurable via `SESSION_TTL_SECONDS`, and supports a
 * sliding window: `src/hooks.server.ts` re-stamps the session cookies on each
 * authenticated page navigation so active users stay logged in.
 *
 * Bounds keep a misconfigured env var from producing a near-instant logout or
 * an effectively permanent session.
 */

/** Default session lifetime: 7 days (matches the previous hardcoded value). */
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Floor so a tiny/zero value can't lock users out immediately. */
export const MIN_SESSION_TTL_SECONDS = 60 * 5; // 5 minutes

/** Ceiling so a runaway value can't create a de-facto permanent session. */
export const MAX_SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

/**
 * Parse a raw `SESSION_TTL_SECONDS` value into a bounded integer number of
 * seconds. Invalid / empty / non-positive input falls back to `fallback`.
 */
export function parseSessionTtlSeconds(
  raw: string | number | null | undefined,
  fallback: number = DEFAULT_SESSION_TTL_SECONDS,
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;

  const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  const seconds = Math.floor(parsed);
  return Math.min(Math.max(seconds, MIN_SESSION_TTL_SECONDS), MAX_SESSION_TTL_SECONDS);
}

/**
 * Resolve the configured session TTL using a caller-supplied env getter so this
 * works in both the edge app (`platform.env`) and Node (`process.env`) — pass a
 * closure over the existing `getEnv(name, platform)` helper.
 */
export function getSessionTtlSeconds(getEnvValue: (name: string) => string | undefined): number {
  return parseSessionTtlSeconds(getEnvValue("SESSION_TTL_SECONDS"));
}
