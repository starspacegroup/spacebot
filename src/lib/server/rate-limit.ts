import { json } from '@sveltejs/kit';
import { getEnvBoolean, getEnvNumber } from '$lib/env.js';
import { decide, rateWindow, type RateWindow } from './rate-limit-core.js';

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

/**
 * Who a request is counted against.
 *
 * Security review 2026-11-05: this used to read the `discord_user_id` cookie,
 * which the client sets, so rotating it bought a fresh bucket per request. It
 * now uses only the user id the hook verified from the signed `sb_session`
 * cookie (`locals.userId`, set by `establishSession` before the limiter runs),
 * then the edge-supplied client IP. Bearer keys keep their prefix bucket.
 */
export function rateLimitIdentity(event: any): string {
	const auth = event.request.headers.get('authorization');
	if (auth?.startsWith('Bearer ')) return `bearer:${auth.slice(7, 23)}`;
	const userId = event.locals?.userId;
	if (typeof userId === 'string' && userId) return `user:${userId}`;
	const ip =
		event.request.headers.get('cf-connecting-ip') ||
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	return ip ? `ip:${ip}` : 'anonymous';
}

/** The RateLimiter Durable Object namespace, when Pages has it bound. */
function limiterNamespace(platform: any): any | null {
	const ns = platform?.env?.RATE_LIMITER;
	return ns && typeof ns.idFromName === 'function' ? ns : null;
}

/**
 * Count one request in the DO and return the count after it, or null when the
 * call failed (the caller then uses the D1 path, so a DO outage degrades to
 * the old behaviour rather than to no limit).
 */
export async function hitDurableLimiter(
	ns: any,
	group: string,
	identity: string,
	win: RateWindow,
	now: number
): Promise<number | null> {
	try {
		const stub = ns.get(ns.idFromName(`${group}:${identity}`));
		const res = await stub.fetch('https://rate-limiter/hit', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ windowStart: win.windowStart, expiresAt: win.expiresAt, now }),
		});
		if (!res.ok) return null;
		const body: any = await res.json();
		const count = Number(body?.count);
		return Number.isFinite(count) && count > 0 ? count : null;
	} catch {
		return null;
	}
}

/** Count one request in D1 and return the count after it. Throws on DB error. */
export async function hitD1Limiter(
	db: any,
	group: string,
	identity: string,
	win: RateWindow,
	now: number
): Promise<number> {
	const key = `${group}:${identity}:${win.windowStart}`;
	await db.prepare('DELETE FROM api_rate_limits WHERE expires_at < ?').bind(now).run();
	await db
		.prepare(
			`INSERT INTO api_rate_limits (key, route_group, window_start, request_count, expires_at, updated_at)
			 VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(key) DO UPDATE SET
			 request_count = request_count + 1,
			 updated_at = CURRENT_TIMESTAMP`
		)
		.bind(key, group, win.windowStart, win.expiresAt)
		.run();
	const current = await db
		.prepare('SELECT request_count FROM api_rate_limits WHERE key = ?')
		.bind(key)
		.first();
	return Number(current?.request_count || 0);
}

/**
 * Consume one unit of a named quota, independent of the global limiter.
 *
 * `checkRateLimit` below is opt-in (`RATE_LIMIT_ENABLED`) and generous (120/min)
 * because it guards ordinary reads. Expensive side-effectful endpoints — an AI
 * completion, creating a Discord invite — need a tight ceiling that applies
 * whether or not the global flag is on, so they call this directly.
 *
 * Uses the RateLimiter DO when `platform.env.RATE_LIMITER` is bound, else D1.
 * Returns the remaining allowance, or `null` when the caller is over budget.
 * Fails open on a DB error: a broken limiter must not break the feature.
 */
export async function consumeQuota(
	db: any,
	group: string,
	identity: string,
	{ max, windowSeconds }: { max: number; windowSeconds: number },
	platform: any = null
): Promise<{ remaining: number; resetAt: number } | null> {
	const now = Math.floor(Date.now() / 1000);
	const win = rateWindow(now, windowSeconds);
	const ns = limiterNamespace(platform);
	if (!db && !ns) return { remaining: max, resetAt: 0 };

	try {
		let used = ns ? await hitDurableLimiter(ns, group, identity, win, now) : null;
		if (used === null) {
			if (!db) return { remaining: max, resetAt: win.expiresAt };
			used = await hitD1Limiter(db, group, identity, win, now);
		}
		const d = decide(used, max, win.expiresAt);
		return d.allowed ? { remaining: d.remaining, resetAt: d.resetAt } : null;
	} catch {
		return { remaining: max, resetAt: win.expiresAt };
	}
}

export async function checkRateLimit(event: any): Promise<Response | null> {
	if (!getEnvBoolean('RATE_LIMIT_ENABLED', event.platform, false)) return null;
	if (!event.url.pathname.startsWith('/api/')) return null;
	if (isRateLimitExempt(event.request, event.url.pathname)) return null;

	const db = event.platform?.env?.DB;
	const ns = limiterNamespace(event.platform);
	if (!db && !ns) return null;

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
	const win = rateWindow(now, windowSeconds);
	const identity = rateLimitIdentity(event);

	let used = ns ? await hitDurableLimiter(ns, routeGroup, identity, win, now) : null;
	if (used === null) {
		if (!db) return null; // DO failed and no D1 to fall back on: fail open
		used = await hitD1Limiter(db, routeGroup, identity, win, now);
	}
	const d = decide(used, maxRequests, win.expiresAt);

	if (!d.allowed) {
		return json(
			{ error: 'Rate limit exceeded', retry_after: win.expiresAt - now },
			{
				status: 429,
				headers: {
					'Retry-After': String(win.expiresAt - now),
					'X-RateLimit-Limit': String(maxRequests),
					'X-RateLimit-Remaining': '0',
					'X-RateLimit-Reset': String(win.expiresAt),
				},
			}
		);
	}

	event.locals.rateLimit = {
		routeGroup,
		limit: maxRequests,
		remaining: d.remaining,
		reset: win.expiresAt,
	};
	return null;
}
