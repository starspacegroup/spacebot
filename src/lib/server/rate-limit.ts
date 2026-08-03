import { json } from '@sveltejs/kit';
import { getEnvBoolean, getEnvNumber } from '$lib/env.js';

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS = 120;

export function getRouteGroup(pathname: string): string {
	if (pathname.startsWith('/api/discord/interactions')) return 'discord-interactions';
	if (pathname.startsWith('/api/runner/ws') || pathname.startsWith('/api/gateway/'))
		return 'realtime';
	if (pathname.startsWith('/api/auth/')) return 'auth';
	if (pathname.startsWith('/api/v1/')) return 'external-api';
	if (pathname.startsWith('/api/')) return 'api';
	return 'page';
}

export function isRateLimitExempt(request: Request, pathname: string): boolean {
	if (pathname.startsWith('/api/discord/interactions')) return true;
	if (pathname.startsWith('/api/runner/ws')) return true;
	if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return true;
	return false;
}

export function rateLimitIdentity(event: any): string {
	const auth = event.request.headers.get('authorization');
	if (auth?.startsWith('Bearer ')) return `bearer:${auth.slice(7, 23)}`;
	return (
		event.cookies.get('discord_user_id') ||
		event.request.headers.get('cf-connecting-ip') ||
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		'anonymous'
	);
}

/**
 * Consume one unit of a named quota, independent of the global limiter.
 *
 * `checkRateLimit` below is opt-in (`RATE_LIMIT_ENABLED`) and generous (120/min)
 * because it guards ordinary reads. Expensive side-effectful endpoints — an AI
 * completion, creating a Discord invite — need a tight ceiling that applies
 * whether or not the global flag is on, so they call this directly.
 *
 * Returns the remaining allowance, or `null` when the caller is over budget.
 * Fails open on a DB error: a broken limiter must not break the feature.
 */
export async function consumeQuota(
	db: any,
	group: string,
	identity: string,
	{ max, windowSeconds }: { max: number; windowSeconds: number }
): Promise<{ remaining: number; resetAt: number } | null> {
	if (!db) return { remaining: max, resetAt: 0 };

	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - (now % windowSeconds);
	const expiresAt = windowStart + windowSeconds;
	const key = `${group}:${identity}:${windowStart}`;

	try {
		await db.prepare('DELETE FROM api_rate_limits WHERE expires_at < ?').bind(now).run();
		await db
			.prepare(
				`INSERT INTO api_rate_limits (key, route_group, window_start, request_count, expires_at, updated_at)
				 VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
				 ON CONFLICT(key) DO UPDATE SET
				 request_count = request_count + 1,
				 updated_at = CURRENT_TIMESTAMP`
			)
			.bind(key, group, windowStart, expiresAt)
			.run();

		const current = await db
			.prepare('SELECT request_count FROM api_rate_limits WHERE key = ?')
			.bind(key)
			.first();
		const used = Number(current?.request_count || 0);
		if (used > max) return null;
		return { remaining: Math.max(0, max - used), resetAt: expiresAt };
	} catch {
		return { remaining: max, resetAt: expiresAt };
	}
}

export async function checkRateLimit(event: any): Promise<Response | null> {
	if (!getEnvBoolean('RATE_LIMIT_ENABLED', event.platform, false)) return null;
	if (!event.url.pathname.startsWith('/api/')) return null;
	if (isRateLimitExempt(event.request, event.url.pathname)) return null;

	const db = event.platform?.env?.DB;
	if (!db) return null;

	const routeGroup = getRouteGroup(event.url.pathname);
	const windowSeconds = getEnvNumber(
		'RATE_LIMIT_DEFAULT_WINDOW_SECONDS',
		event.platform,
		DEFAULT_WINDOW_SECONDS
	);
	const maxRequests = getEnvNumber(
		'RATE_LIMIT_DEFAULT_MAX_REQUESTS',
		event.platform,
		DEFAULT_MAX_REQUESTS
	);
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - (now % windowSeconds);
	const expiresAt = windowStart + windowSeconds;
	const key = `${routeGroup}:${rateLimitIdentity(event)}:${windowStart}`;

	await db.prepare('DELETE FROM api_rate_limits WHERE expires_at < ?').bind(now).run();
	await db
		.prepare(
			`INSERT INTO api_rate_limits (key, route_group, window_start, request_count, expires_at, updated_at)
			 VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(key) DO UPDATE SET
			 request_count = request_count + 1,
			 updated_at = CURRENT_TIMESTAMP`
		)
		.bind(key, routeGroup, windowStart, expiresAt)
		.run();

	const current = await db
		.prepare('SELECT request_count FROM api_rate_limits WHERE key = ?')
		.bind(key)
		.first();
	const remaining = Math.max(0, maxRequests - Number(current?.request_count || 0));

	if (Number(current?.request_count || 0) > maxRequests) {
		return json(
			{ error: 'Rate limit exceeded', retry_after: expiresAt - now },
			{
				status: 429,
				headers: {
					'Retry-After': String(expiresAt - now),
					'X-RateLimit-Limit': String(maxRequests),
					'X-RateLimit-Remaining': '0',
					'X-RateLimit-Reset': String(expiresAt),
				},
			}
		);
	}

	event.locals.rateLimit = { routeGroup, limit: maxRequests, remaining, reset: expiresAt };
	return null;
}
