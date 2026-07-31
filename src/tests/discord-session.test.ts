import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	DISCORD_SESSION_COOKIES,
	clearDiscordSession,
	refreshDiscordAccessToken,
	requiresDiscordSession,
	resolveDiscordSession,
	sessionClearCookieHeaders,
	shouldCheckDiscordSession,
} from '../lib/server/discord-session.js';

/** Minimal stand-in for SvelteKit's Cookies, recording writes for assertions. */
function fakeCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	const sets: Array<{ name: string; value: string; options: any }> = [];
	const deletes: string[] = [];

	return {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string, options: any) => {
			jar.set(name, value);
			sets.push({ name, value, options });
		},
		delete: (name: string) => {
			jar.delete(name);
			deletes.push(name);
		},
		sets,
		deletes,
		jar,
	};
}

const env: Record<string, string> = {
	DISCORD_CLIENT_ID: 'client-id',
	DISCORD_CLIENT_SECRET: 'client-secret',
};
const getEnvValue = (name: string) => env[name];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function tokenResponse(body: any, ok = true, status = 200) {
	return { ok, status, json: async () => body };
}

describe('refreshDiscordAccessToken', () => {
	it('returns null without calling Discord when no refresh token is stored', async () => {
		const cookies = fakeCookies({ discord_user_id: '1' });

		const result = await refreshDiscordAccessToken({
			cookies: cookies as any,
			getEnvValue,
			secure: true,
		});

		expect(result).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('exchanges the refresh token and stores both rotated tokens', async () => {
		const cookies = fakeCookies({ discord_refresh_token: 'old-refresh' });
		fetchMock.mockResolvedValue(
			tokenResponse({
				access_token: 'new-access',
				refresh_token: 'new-refresh',
				expires_in: 604800,
			})
		);

		const result = await refreshDiscordAccessToken({
			cookies: cookies as any,
			getEnvValue,
			secure: true,
		});

		expect(result).toBe('new-access');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://discord.com/api/oauth2/token');
		const body = new URLSearchParams(init.body as string);
		expect(body.get('grant_type')).toBe('refresh_token');
		expect(body.get('refresh_token')).toBe('old-refresh');
		expect(body.get('client_id')).toBe('client-id');

		const access = cookies.sets.find((c) => c.name === 'discord_access_token');
		expect(access?.value).toBe('new-access');
		expect(access?.options).toMatchObject({
			path: '/',
			httpOnly: true,
			secure: true,
			maxAge: 604800,
		});

		// Discord rotates the refresh token on use — persisting it is what makes the
		// *next* refresh work.
		const refresh = cookies.sets.find((c) => c.name === 'discord_refresh_token');
		expect(refresh?.value).toBe('new-refresh');
		expect(refresh?.options).toMatchObject({ maxAge: 60 * 60 * 24 * 30 });
	});

	it('falls back to a 7-day lifetime when Discord omits expires_in', async () => {
		const cookies = fakeCookies({ discord_refresh_token: 'old-refresh' });
		fetchMock.mockResolvedValue(tokenResponse({ access_token: 'new-access' }));

		await refreshDiscordAccessToken({ cookies: cookies as any, getEnvValue, secure: false });

		const access = cookies.sets.find((c) => c.name === 'discord_access_token');
		expect(access?.options).toMatchObject({ maxAge: 604800, secure: false });
	});

	it('returns null when Discord rejects the refresh token', async () => {
		const cookies = fakeCookies({ discord_refresh_token: 'revoked' });
		fetchMock.mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, false, 400));

		const result = await refreshDiscordAccessToken({
			cookies: cookies as any,
			getEnvValue,
			secure: true,
		});

		expect(result).toBeNull();
		expect(cookies.sets).toHaveLength(0);
	});

	it('returns null when the token endpoint throws', async () => {
		const cookies = fakeCookies({ discord_refresh_token: 'old-refresh' });
		fetchMock.mockRejectedValue(new Error('network down'));

		const result = await refreshDiscordAccessToken({
			cookies: cookies as any,
			getEnvValue,
			secure: true,
		});

		expect(result).toBeNull();
		expect(cookies.sets).toHaveLength(0);
	});

	it('returns null when OAuth credentials are not configured', async () => {
		const cookies = fakeCookies({ discord_refresh_token: 'old-refresh' });

		const result = await refreshDiscordAccessToken({
			cookies: cookies as any,
			getEnvValue: () => undefined,
			secure: true,
		});

		expect(result).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('resolveDiscordSession', () => {
	it('reports anonymous when there is no session', async () => {
		const cookies = fakeCookies();

		await expect(
			resolveDiscordSession({ cookies: cookies as any, getEnvValue, secure: true })
		).resolves.toBe('anonymous');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports active without refreshing while the access token is present', async () => {
		const cookies = fakeCookies({ discord_user_id: '1', discord_access_token: 'live' });

		await expect(
			resolveDiscordSession({ cookies: cookies as any, getEnvValue, secure: true })
		).resolves.toBe('active');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refreshes an identity-only session back to active', async () => {
		const cookies = fakeCookies({ discord_user_id: '1', discord_refresh_token: 'old-refresh' });
		fetchMock.mockResolvedValue(tokenResponse({ access_token: 'new-access' }));

		await expect(
			resolveDiscordSession({ cookies: cookies as any, getEnvValue, secure: true })
		).resolves.toBe('active');
		expect(cookies.get('discord_access_token')).toBe('new-access');
	});

	it('reports expired when the identity outlived the token and refresh fails', async () => {
		// The exact state that rendered "Unknown Server" with zeroed stats: sliding
		// identity cookies, no access token, nothing prompting a re-login.
		const cookies = fakeCookies({ discord_user_id: '1' });

		await expect(
			resolveDiscordSession({ cookies: cookies as any, getEnvValue, secure: true })
		).resolves.toBe('expired');
	});
});

describe('shouldCheckDiscordSession', () => {
	const navigation = {
		method: 'GET',
		pathname: '/admin/123',
		accept: 'text/html,application/xhtml+xml',
		hasIdentityCookie: true,
	};

	it('checks authenticated HTML page navigations', () => {
		expect(shouldCheckDiscordSession(navigation)).toBe(true);
	});

	it('skips anonymous visitors', () => {
		expect(shouldCheckDiscordSession({ ...navigation, hasIdentityCookie: false })).toBe(false);
	});

	it('skips non-GET requests and asset/API traffic', () => {
		expect(shouldCheckDiscordSession({ ...navigation, method: 'POST' })).toBe(false);
		expect(shouldCheckDiscordSession({ ...navigation, pathname: '/_app/immutable/x.js' })).toBe(
			false
		);
		// A refresh here could race a concurrent one and invalidate the rotated
		// token; API callers heal on the next navigation instead.
		expect(
			shouldCheckDiscordSession({ ...navigation, pathname: '/api/admin/123/dashboard-stats' })
		).toBe(false);
	});

	it('skips /login so a failed re-auth cannot bounce in a loop', () => {
		expect(shouldCheckDiscordSession({ ...navigation, pathname: '/login' })).toBe(false);
	});

	it('skips data requests that do not accept HTML', () => {
		expect(shouldCheckDiscordSession({ ...navigation, accept: 'application/json' })).toBe(
			false
		);
	});
});

describe('requiresDiscordSession', () => {
	it('is true for the pages built from Discord data', () => {
		expect(requiresDiscordSession('/admin/123')).toBe(true);
		expect(requiresDiscordSession('/account')).toBe(true);
	});

	it('is false for public pages, which just render signed-out', () => {
		expect(requiresDiscordSession('/')).toBe(false);
		expect(requiresDiscordSession('/docs')).toBe(false);
		expect(requiresDiscordSession('/privacy')).toBe(false);
	});
});

describe('session clearing', () => {
	it('deletes every session cookie', () => {
		const cookies = fakeCookies({ discord_user_id: '1', discord_access_token: 'live' });

		clearDiscordSession(cookies as any);

		expect(cookies.deletes).toEqual(DISCORD_SESSION_COOKIES);
		expect(cookies.get('discord_user_id')).toBeUndefined();
	});

	it('builds expiring Set-Cookie headers for hand-built responses', () => {
		const headers = sessionClearCookieHeaders(true);

		expect(headers).toHaveLength(DISCORD_SESSION_COOKIES.length);
		for (const name of DISCORD_SESSION_COOKIES) {
			const header = headers.find((h) => h.startsWith(`${name}=;`));
			expect(header).toBeDefined();
			expect(header).toContain('Max-Age=0');
			expect(header).toContain('Path=/');
			expect(header).toContain('Secure');
		}
	});

	it('omits Secure on insecure origins so local http sessions can be cleared', () => {
		for (const header of sessionClearCookieHeaders(false)) {
			expect(header).not.toContain('Secure');
		}
	});
});
