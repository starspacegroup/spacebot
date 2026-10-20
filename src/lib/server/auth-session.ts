/**
 * Server-validated session (security review 2026-10-20, finding #1).
 *
 * `discord_user_id` used to BE the session: an unsigned cookie anyone could
 * write by hand to become any Discord user, superadmins included. Identity now
 * comes only from `sb_session`, an HMAC-SHA256-signed token minted by the OAuth
 * callback after Discord's token exchange, keyed by the `SESSION_SECRET`
 * Wrangler secret.
 *
 * `establishSession` runs at the top of every request in `hooks.server.ts` and
 * enforces one invariant the ~100 existing `cookies.get('discord_user_id')`
 * readers rely on: after the hook, that cookie either equals the verified
 * session's user id or reads as absent. A forged or legacy (pre-signing)
 * cookie set is cleared, so it reaches no route.
 *
 * Without `SESSION_SECRET` outside dev, no session verifies and logins fail
 * closed rather than falling back to an unsigned identity.
 */

import { DISCORD_SESSION_COOKIES } from './discord-session.js';

export const SESSION_COOKIE = 'sb_session';
const TOKEN_VERSION = 'v1';
const DEV_FALLBACK_SECRET = 'spacebot-dev-only-session-secret';
const MIN_SECRET_LENGTH = 32;

export interface SessionPayload {
	uid: string;
	iat: number;
	exp: number;
}

type EnvLookup = (name: string) => string | undefined;

export function getSessionSecret(getEnvValue: EnvLookup, isDev: boolean): string | null {
	const secret = getEnvValue('SESSION_SECRET');
	if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
	return isDev ? DEV_FALLBACK_SECRET : null;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
	const padded =
		text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
	try {
		return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

export async function signSession(
	uid: string,
	ttlSeconds: number,
	secret: string,
	nowMs: number = Date.now()
): Promise<string> {
	const iat = Math.floor(nowMs / 1000);
	const payload: SessionPayload = { uid, iat, exp: iat + ttlSeconds };
	const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
	const signed = `${TOKEN_VERSION}.${body}`;
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(signed));
	return `${signed}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySession(
	token: string | undefined | null,
	secret: string | null,
	nowMs: number = Date.now()
): Promise<SessionPayload | null> {
	if (!token || !secret) return null;
	const parts = token.split('.');
	if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
	const sig = fromBase64Url(parts[2]);
	const body = fromBase64Url(parts[1]);
	if (!sig || !body) return null;
	const ok = await crypto.subtle.verify(
		'HMAC',
		await hmacKey(secret),
		sig,
		encoder.encode(`${parts[0]}.${parts[1]}`)
	);
	if (!ok) return null;
	let payload: SessionPayload;
	try {
		payload = JSON.parse(new TextDecoder().decode(body));
	} catch {
		return null;
	}
	if (typeof payload?.uid !== 'string' || !/^\d{1,25}$/.test(payload.uid)) return null;
	if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
	return payload;
}

export interface SessionCookieOptions {
	secure: boolean;
	maxAge: number;
	httpOnly?: boolean;
}

export async function issueSessionCookie(
	cookies: import('@sveltejs/kit').Cookies,
	uid: string,
	secret: string,
	options: SessionCookieOptions
): Promise<void> {
	const token = await signSession(uid, options.maxAge, secret);
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: options.httpOnly ?? true,
		secure: options.secure,
		sameSite: 'lax',
		maxAge: options.maxAge,
	});
}

export function clearAuthCookies(cookies: import('@sveltejs/kit').Cookies): void {
	for (const name of [...DISCORD_SESSION_COOKIES, 'dev_auth_role']) {
		cookies.delete(name, { path: '/' });
	}
}

/**
 * Verify `sb_session` and make `discord_user_id` agree with it.
 * Returns the verified user id, or null for an anonymous request.
 */
export async function establishSession(
	cookies: import('@sveltejs/kit').Cookies,
	secret: string | null,
	secure: boolean
): Promise<string | null> {
	const session = await verifySession(cookies.get(SESSION_COOKIE), secret);
	if (!session) {
		const hasAnyAuthCookie = DISCORD_SESSION_COOKIES.some(
			(name) => cookies.get(name) !== undefined
		);
		if (hasAnyAuthCookie) clearAuthCookies(cookies);
		return null;
	}
	if (cookies.get('discord_user_id') !== session.uid) {
		cookies.set('discord_user_id', session.uid, {
			path: '/',
			httpOnly: true,
			secure,
			sameSite: 'lax',
			maxAge: Math.max(1, session.exp - Math.floor(Date.now() / 1000)),
		});
	}
	return session.uid;
}
