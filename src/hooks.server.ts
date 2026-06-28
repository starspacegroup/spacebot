import { json, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { log } from '$lib/log.js';
import { upsertUser } from '$lib/db/users.js';
import { trackUserActivity } from '$lib/db/user-activity.js';
import { handleGatewayLogsApi } from '$lib/server/gateway-logs-api.js';
import { applySecurityHeaders } from '$lib/server/security-headers.js';
import { getSessionTtlSeconds } from '$lib/server/session.js';
import { checkRateLimit } from '$lib/server/rate-limit.js';
import { finishSpan, startSpan } from '$lib/server/telemetry.js';
import { resolveLocale } from '$lib/i18n.js';

/**
 * Dev Auth Bypass
 *
 * In development mode, allows bypassing Discord OAuth by:
 * 1. Setting DEV_AUTH_BYPASS=true in .env
 * 2. Visiting /dev-login to instantly log in as a dev user
 * 3. Or adding ?dev_auth=true to any URL
 *
 * Supports role-based fake identities via /dev-login?role=user|admin|superadmin.
 * Superadmin defaults to first ADMIN_USER_IDS entry so existing checks still work.
 */

/**
 * Safely get environment variable, works in both Node.js and Cloudflare Workers
 * @param {string} name - Environment variable name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform - SvelteKit platform object
 * @returns {string|undefined}
 */
function getEnv(name, platform) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

function parseAdminUserIds(platform) {
	return (getEnv('ADMIN_USER_IDS', platform) || '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
}

function normalizeDevRole(value) {
	if (value === 'user' || value === 'admin' || value === 'superadmin') {
		return value;
	}
	return 'superadmin';
}

function getDefaultDevUserIdForRole(role, platform) {
	const adminUserIds = parseAdminUserIds(platform);
	const firstAdminId = adminUserIds[0] || null;

	if (role === 'superadmin') {
		return (
			getEnv('DEV_SUPERADMIN_USER_ID', platform) ||
			firstAdminId ||
			getEnv('DEV_USER_ID', platform) ||
			'000000000000000001'
		);
	}

	const roleSpecific =
		role === 'admin'
			? getEnv('DEV_ADMIN_USER_ID', platform)
			: getEnv('DEV_REGULAR_USER_ID', platform);

	const explicitOrFallback = roleSpecific || getEnv('DEV_USER_ID', platform);
	if (explicitOrFallback && !adminUserIds.includes(explicitOrFallback)) {
		return explicitOrFallback;
	}

	// Keep non-superadmin roles outside ADMIN_USER_IDS by default.
	return role === 'admin' ? '000000000000000010' : '000000000000000020';
}

function shouldTrackPath(pathname) {
	if (!pathname || pathname.startsWith('/_app/') || pathname.startsWith('/_functions/')) {
		return false;
	}

	if (
		pathname === '/favicon.ico' ||
		pathname === '/robots.txt' ||
		pathname === '/sitemap.xml' ||
		pathname === '/manifest.webmanifest'
	) {
		return false;
	}

	return !/\.(?:css|js|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|json)$/i.test(pathname);
}

function classifyActivityType(pathname, method) {
	if (pathname.startsWith('/api/')) return 'api_action';
	if (method === 'GET') return 'page_view';
	return 'action';
}

function sanitizeQueryString(searchParams) {
	if (!searchParams || typeof searchParams.entries !== 'function') return '';

	const redactedKeys = new Set([
		'code',
		'state',
		'token',
		'access_token',
		'refresh_token',
		'password',
		'secret',
		'api_key',
		'key',
	]);

	const next = new URLSearchParams();
	for (const [key, value] of searchParams.entries()) {
		if (redactedKeys.has(String(key).toLowerCase())) {
			next.set(key, '[redacted]');
		} else {
			next.set(key, value);
		}
	}

	return next.toString();
}

function getRequestIp(event) {
	const cfIp = event.request.headers.get('cf-connecting-ip');
	if (cfIp) return cfIp;

	const forwarded = event.request.headers.get('x-forwarded-for');
	if (!forwarded) return null;

	const [first] = forwarded.split(',');
	return first?.trim() || null;
}

async function trackAuthenticatedRequestActivity(event, statusCode, details = null) {
	const userId = event.cookies.get('discord_user_id');
	if (!userId) return;

	const db = event.platform?.env?.DB;
	if (!db) return;

	const pathname = event.url.pathname;
	if (!shouldTrackPath(pathname)) return;

	const method = String(event.request.method || 'GET').toUpperCase();
	const queryString = sanitizeQueryString(event.url.searchParams);

	await trackUserActivity(db, {
		userId,
		activityType: classifyActivityType(pathname, method),
		method,
		path: pathname,
		queryString: queryString || null,
		statusCode,
		referrer: event.request.headers.get('referer') || null,
		ipAddress: getRequestIp(event),
		userAgent: event.request.headers.get('user-agent') || null,
		details,
	});
}

/**
 * Get dev user configuration from environment
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform
 */
function getDevUser(platform, role = 'superadmin') {
	const normalizedRole = normalizeDevRole(role);
	const devUserId = getDefaultDevUserIdForRole(normalizedRole, platform);
	const defaultName =
		normalizedRole === 'superadmin'
			? 'DevSuperadmin'
			: normalizedRole === 'admin'
				? 'DevAdmin'
				: 'DevUser';
	const defaultGlobalName =
		normalizedRole === 'superadmin'
			? 'Development Superadmin'
			: normalizedRole === 'admin'
				? 'Development Admin'
				: 'Development User';

	log.debug('[DevAuth] Using dev user ID:', devUserId, 'role:', normalizedRole);

	return {
		id: devUserId,
		username: getEnv('DEV_USERNAME', platform) || defaultName,
		globalName: getEnv('DEV_GLOBAL_NAME', platform) || defaultGlobalName,
		avatar: getEnv('DEV_AVATAR', platform) || null,
		discriminator: '0',
		role: normalizedRole,
	};
}

/**
 * Set dev auth cookies
 * @param {import('@sveltejs/kit').Cookies} cookies
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform
 */
function setDevAuthCookies(cookies, platform, role = 'superadmin') {
	const devUser = getDevUser(platform, role);
	const cookieOptions = {
		path: '/',
		httpOnly: false,
		secure: false,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 7, // 1 week
	};

	cookies.set('discord_user_id', devUser.id, cookieOptions);
	cookies.set('discord_username', devUser.username, cookieOptions);
	cookies.set('discord_global_name', devUser.globalName, cookieOptions);
	if (devUser.avatar) {
		cookies.set('discord_avatar', devUser.avatar, cookieOptions);
	}
	cookies.set('discord_discriminator', devUser.discriminator, cookieOptions);

	// Set a mock access token for API calls
	cookies.set('discord_access_token', 'dev_mock_token', cookieOptions);
	cookies.set('dev_auth_role', devUser.role, cookieOptions);

	log.debug(
		'[DevAuth] Set dev auth cookies for user:',
		devUser.username,
		`(${devUser.id}) role=${devUser.role}`
	);

	return devUser;
}

/**
 * Cookies that make up a Discord session/profile and should slide forward while
 * a user is active. Access/refresh tokens are intentionally excluded — their
 * lifetime is governed by Discord, not our session window.
 */
const SLIDING_SESSION_COOKIES = [
	'discord_user',
	'discord_user_id',
	'discord_username',
	'discord_avatar',
	'discord_global_name',
	'discord_discriminator',
];

/**
 * Whether the current request is over a secure connection (directly or behind a
 * proxy/tunnel). Mirrors the logic used in the OAuth callback so refreshed
 * cookies keep the same `secure` attribute they were set with.
 */
function isSecureRequest(event) {
	return (
		event.request.headers.get('x-forwarded-proto') === 'https' ||
		event.url.protocol === 'https:'
	);
}

/**
 * Sliding session expiration: on authenticated HTML page navigations, re-stamp
 * the session/profile cookies with a fresh, configurable TTL so active users
 * are not logged out mid-session.
 *
 * Must run BEFORE `resolve(event)` — SvelteKit serializes its cookie jar into
 * the response's Set-Cookie headers as part of `resolve`, so cookies set after
 * `await resolve(event)` are silently dropped. We therefore gate on the request
 * (GET navigation that accepts HTML) rather than the response content-type.
 *
 * Gated to non-dev so it never flips the httpOnly/secure attributes of the
 * dev-auth-bypass cookies.
 */
function applySlidingSession(event) {
	if (dev) return;
	if (!event.cookies.get('discord_user_id')) return;

	if (String(event.request.method || 'GET').toUpperCase() !== 'GET') return;

	const pathname = event.url.pathname;
	if (pathname.startsWith('/_app/') || pathname.startsWith('/api/')) return;

	const accept = event.request.headers.get('accept') || '';
	if (!accept.includes('text/html')) return;

	const maxAge = getSessionTtlSeconds((name) => getEnv(name, event.platform));
	const cookieOptions = {
		path: '/',
		httpOnly: true,
		secure: isSecureRequest(event),
		sameSite: 'lax',
		maxAge,
	};

	for (const name of SLIDING_SESSION_COOKIES) {
		const value = event.cookies.get(name);
		if (value !== undefined) {
			event.cookies.set(name, value, cookieOptions);
		}
	}
}

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	const { url, cookies, platform } = event;
	const requestSpan = startSpan('sveltekit.request', {
		method: event.request.method,
		path: url.pathname,
	});

	try {
		const isDevAuthPath = url.pathname === '/dev-login' || url.pathname === '/dev-logout';
		const hasDevAuthParams =
			url.searchParams.has('dev_auth') || url.searchParams.has('dev_role');

		// Never allow dev auth controls outside SvelteKit dev builds.
		if (!dev && (isDevAuthPath || hasDevAuthParams)) {
			return new Response('Not found', {
				status: 404,
				headers: {
					'Content-Type': 'text/plain; charset=utf-8',
					'Cache-Control': 'no-store',
				},
			});
		}

		const devAuthEnabled = dev && getEnv('DEV_AUTH_BYPASS', platform) === 'true';

		// Handle dev auth bypass
		if (devAuthEnabled) {
			// Special /dev-login route for easy dev authentication
			if (url.pathname === '/dev-login') {
				const role = normalizeDevRole(url.searchParams.get('role') || 'superadmin');
				const devUser = setDevAuthCookies(cookies, platform, role);

				// Track dev user in the database so they appear in User Management
				const db = (platform as any)?.env?.DB;
				if (db) {
					const isSuperAdmin = parseAdminUserIds(platform).includes(devUser.id);
					try {
						await upsertUser(db, {
							id: devUser.id,
							username: devUser.username,
							global_name: devUser.globalName || null,
							avatar: devUser.avatar || null,
							discriminator: devUser.discriminator || '0',
							is_superadmin: isSuperAdmin,
						});
					} catch (err) {
						log.error('[DevAuth] Failed to track dev user login:', err);
					}
				}

				const returnTo = url.searchParams.get('return_to') || '/admin';
				// Use SvelteKit's redirect to ensure cookies are properly sent
				throw redirect(302, returnTo);
			}

			// Special /dev-logout route to clear dev auth
			if (url.pathname === '/dev-logout') {
				const cookieOptions = { path: '/' };
				cookies.delete('discord_user_id', cookieOptions);
				cookies.delete('discord_username', cookieOptions);
				cookies.delete('discord_global_name', cookieOptions);
				cookies.delete('discord_avatar', cookieOptions);
				cookies.delete('discord_discriminator', cookieOptions);
				cookies.delete('discord_access_token', cookieOptions);
				cookies.delete('dev_auth_role', cookieOptions);

				log.debug('[DevAuth] Cleared dev auth cookies');
				throw redirect(302, '/');
			}

			// Allow ?dev_auth=true query param to auto-login
			if (url.searchParams.get('dev_auth') === 'true') {
				const userId = cookies.get('discord_user_id');
				if (!userId) {
					const role = normalizeDevRole(url.searchParams.get('dev_role') || 'superadmin');
					const devUser = setDevAuthCookies(cookies, platform, role);

					// Track dev user in the database
					const db = (platform as any)?.env?.DB;
					if (db) {
						const isSuperAdmin = parseAdminUserIds(platform).includes(devUser.id);
						try {
							await upsertUser(db, {
								id: devUser.id,
								username: devUser.username,
								global_name: devUser.globalName || null,
								avatar: devUser.avatar || null,
								discriminator: devUser.discriminator || '0',
								is_superadmin: isSuperAdmin,
							});
						} catch (err) {
							log.error('[DevAuth] Failed to track dev user login:', err);
						}
					}

					// Remove the dev_auth param and redirect
					const cleanUrl = new URL(url);
					cleanUrl.searchParams.delete('dev_auth');
					cleanUrl.searchParams.delete('dev_role');
					throw redirect(302, cleanUrl.pathname + cleanUrl.search);
				}
			}
		}

		// Add dev auth status to event.locals for use in routes
		(event.locals as any).devAuthEnabled = devAuthEnabled;

		const rateLimitResponse = await checkRateLimit(event);
		if (rateLimitResponse) {
			finishSpan(requestSpan, platform);
			return applySecurityHeaders(rateLimitResponse);
		}

		if (url.pathname === '/api/gateway/logs') {
			const response = await handleGatewayLogsApi(event);
			await trackAuthenticatedRequestActivity(event, response?.status || 200);
			finishSpan(requestSpan, platform);
			return applySecurityHeaders(response);
		}

		// Sliding session expiration on authenticated page navigations. Must run
		// before resolve() so the refreshed cookies are serialized into the response.
		applySlidingSession(event);

		// i18n: set <html lang> from the resolved locale (cookie → Accept-Language
		// → default). Mirrors the resolution in +layout.server.ts.
		const locale = resolveLocale({
			cookie: cookies.get('spacebot_locale'),
			acceptLanguage: event.request.headers.get('accept-language'),
		});

		const response = await resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%lang%', locale),
		});

		// Add cache headers for dynamic content to ensure fresh data
		// Assets in /_app/ are already hashed and can be cached long-term
		// /api/ routes manage their own cache headers
		// All other routes (HTML pages + SvelteKit __data.json fetches) must not be cached
		if (!url.pathname.startsWith('/_app/') && !url.pathname.startsWith('/api/')) {
			response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
			response.headers.set('Pragma', 'no-cache');
			response.headers.set('Expires', '0');
		}

		// Security headers (HTML responses only; no-op for API/assets/WebSocket).
		// Safe to set after resolve() because this mutates the returned Response's
		// own headers, unlike cookies (which SvelteKit serializes during resolve).
		applySecurityHeaders(response);

		await trackAuthenticatedRequestActivity(event, response?.status || 200);
		finishSpan(requestSpan, platform);

		return response;
	} catch (error) {
		const isRedirect = Boolean(
			error &&
			typeof error === 'object' &&
			typeof error.status === 'number' &&
			error.status >= 300 &&
			error.status < 400 &&
			typeof error.location === 'string'
		);

		if (isRedirect) {
			throw error;
		}

		log.error('[Hooks] Unhandled request error', {
			method: event.request.method,
			path: url.pathname,
			search: url.search,
			cfRay: event.request.headers.get('cf-ray') || null,
			error: error?.stack || error?.message || String(error),
		});

		if (url.pathname.startsWith('/api/')) {
			await trackAuthenticatedRequestActivity(event, 500, { internalError: true });
			finishSpan(requestSpan, platform);
			return json({ error: 'Internal server error' }, { status: 500 });
		}

		await trackAuthenticatedRequestActivity(event, 500, { internalError: true });
		finishSpan(requestSpan, platform);
		return new Response('Internal server error', {
			status: 500,
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Cache-Control': 'no-store',
			},
		});
	}
}
