/**
 * Discord session lifecycle: token refresh and expiry handling.
 *
 * The session is made of two independent things with different lifetimes:
 *
 * - **Identity cookies** (`discord_user_id`, `discord_username`, …) — ours.
 *   `src/hooks.server.ts` slides them forward on every authenticated page
 *   navigation, so an active user stays logged in indefinitely.
 * - **`discord_access_token`** — Discord's, and it expires in 7 days.
 *
 * Because only the first set slides, the two drift apart: after 7 days a user
 * is still "logged in" with no usable token. Every Discord-backed call then
 * fails soft — `getUserGuilds` returns `[]`, the dashboard renders "Unknown
 * Server" with zeroed stats, and `/api/admin/[serverId]/dashboard-stats`
 * answers 401 — with nothing prompting a re-login. This module closes that gap:
 *
 * 1. `refreshDiscordAccessToken` spends the (30-day) `discord_refresh_token`
 *    that the OAuth callback has always stored but never used.
 * 2. `clearDiscordSession` wipes the whole session when that fails, so callers
 *    can bounce the user to /login instead of serving a half-authenticated page.
 */

import { log } from '$lib/log.js';

/** Cookies that make up a Discord session — identity, profile, and tokens. */
export const DISCORD_SESSION_COOKIES = [
	'discord_user',
	'discord_user_id',
	'discord_username',
	'discord_avatar',
	'discord_global_name',
	'discord_discriminator',
	'discord_access_token',
	'discord_refresh_token',
];

/** Fallback access-token lifetime when Discord omits `expires_in` (7 days). */
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 604800;

/** Refresh-token cookie lifetime (30 days), matching the OAuth callback. */
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Discord's token endpoint can hang; don't hold a page navigation on it. */
const TOKEN_REFRESH_TIMEOUT_MS = 5000;

/**
 * Delete every Discord session cookie.
 *
 * @param {import('@sveltejs/kit').Cookies} cookies
 */
export function clearDiscordSession(cookies) {
	for (const name of DISCORD_SESSION_COOKIES) {
		cookies.delete(name, { path: '/' });
	}
}

/**
 * `Set-Cookie` values that expire every session cookie.
 *
 * Used when a response is built directly rather than through `resolve(event)` —
 * SvelteKit only serializes its cookie jar as part of `resolve`, so a hook that
 * short-circuits with its own Response has to write the headers itself or the
 * "clear" silently does nothing and the user bounces to /login forever.
 *
 * @param {boolean} secure - Whether to mark the cookies Secure
 * @returns {string[]}
 */
export function sessionClearCookieHeaders(secure) {
	const attrs = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
	return DISCORD_SESSION_COOKIES.map((name) => `${name}=; ${attrs}`);
}

/**
 * Exchange the stored refresh token for a fresh access token and write both
 * back as cookies.
 *
 * Discord rotates refresh tokens on use, so the new one must be persisted or
 * the next refresh fails. Callers should invoke this at most once per request,
 * and only on page navigations — never in parallel — so two in-flight refreshes
 * can't race and invalidate each other's rotated token.
 *
 * @param {object} options
 * @param {import('@sveltejs/kit').Cookies} options.cookies
 * @param {(name: string) => string | undefined} options.getEnvValue
 * @param {boolean} options.secure - `secure` attribute for the written cookies
 * @returns {Promise<string|null>} The new access token, or null if refresh failed
 */
export async function refreshDiscordAccessToken({ cookies, getEnvValue, secure }) {
	const refreshToken = cookies.get('discord_refresh_token');
	if (!refreshToken) return null;

	const clientId = getEnvValue('DISCORD_CLIENT_ID');
	const clientSecret = getEnvValue('DISCORD_CLIENT_SECRET');
	if (!clientId || !clientSecret) {
		log.error('[Session] Cannot refresh token: DISCORD_CLIENT_ID/SECRET not configured');
		return null;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), TOKEN_REFRESH_TIMEOUT_MS);

	let tokenData;
	try {
		const response = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			// 400/401 means the refresh token is revoked or expired — the session is
			// genuinely over. Anything else is transient, but either way we have no
			// token to offer this request.
			log.warn('[Session] Refresh token exchange failed:', response.status);
			return null;
		}

		tokenData = await response.json();
	} catch (error) {
		log.error('[Session] Error refreshing Discord access token:', error);
		return null;
	} finally {
		clearTimeout(timeoutId);
	}

	if (!tokenData?.access_token) {
		log.warn('[Session] Refresh response contained no access_token');
		return null;
	}

	const cookieOptions = { path: '/', httpOnly: true, secure, sameSite: 'lax' as const };

	cookies.set('discord_access_token', tokenData.access_token, {
		...cookieOptions,
		maxAge: tokenData.expires_in || DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
	});

	if (tokenData.refresh_token) {
		cookies.set('discord_refresh_token', tokenData.refresh_token, {
			...cookieOptions,
			maxAge: REFRESH_TOKEN_TTL_SECONDS,
		});
	}

	log.debug('[Session] Refreshed Discord access token');
	return tokenData.access_token;
}

/**
 * Resolve the session state for a request that has already been established as
 * an authenticated page navigation.
 *
 * - `"active"` — an access token is present (or was just refreshed)
 * - `"anonymous"` — no session at all
 * - `"expired"` — identity cookies survive but the token is gone and could not
 *   be refreshed; the caller should clear the session and send the user to /login
 *
 * @param {object} options
 * @param {import('@sveltejs/kit').Cookies} options.cookies
 * @param {(name: string) => string | undefined} options.getEnvValue
 * @param {boolean} options.secure
 * @returns {Promise<"active"|"anonymous"|"expired">}
 */
export async function resolveDiscordSession({ cookies, getEnvValue, secure }) {
	if (!cookies.get('discord_user_id')) return 'anonymous';
	if (cookies.get('discord_access_token')) return 'active';

	const refreshed = await refreshDiscordAccessToken({ cookies, getEnvValue, secure });
	return refreshed ? 'active' : 'expired';
}

/**
 * Whether a request should have its session checked.
 *
 * Deliberately narrow: HTML page navigations only. That is where a refreshed
 * cookie can still reach the response, and it keeps refreshes effectively
 * single-flight — Discord rotates the refresh token on use, so two concurrent
 * refreshes would invalidate each other. `/api/` requests are left alone and
 * heal on the next navigation.
 *
 * @param {object} request
 * @param {string} request.method
 * @param {string} request.pathname
 * @param {string} request.accept - The request's Accept header
 * @param {boolean} request.hasIdentityCookie - Whether `discord_user_id` is set
 * @returns {boolean}
 */
export function shouldCheckDiscordSession({ method, pathname, accept, hasIdentityCookie }) {
	if (!hasIdentityCookie) return false;
	if (String(method || 'GET').toUpperCase() !== 'GET') return false;
	if (pathname.startsWith('/_app/') || pathname.startsWith('/api/')) return false;
	// Never redirect away from the pages that exist to fix a broken session.
	if (pathname === '/login') return false;
	return (accept || '').includes('text/html');
}

/**
 * Whether a path needs a working Discord session to render anything truthful.
 *
 * Only these get bounced to /login when the session is dead; everywhere else a
 * cleared session is enough, and the page renders signed-out rather than yanking
 * a reader off the docs.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function requiresDiscordSession(pathname) {
	return pathname.startsWith('/admin') || pathname.startsWith('/account');
}
