import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState: any = {
	authenticated: true,
	guildId: '111111111111111111',
	scopes: ['stats:read'],
	status: undefined,
	error: undefined,
};
const adminState: any = { authorized: false };

vi.mock('$lib/api-auth.js', () => ({
	authenticateApiKey: vi.fn(async () => authState),
	hasScope: (auth: any, scope: string) => Boolean(auth.scopes?.includes(scope)),
}));
vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: vi.fn(async () => adminState),
}));
vi.mock('$lib/db/server-stats.js', () => ({
	getServerStatsHistory: vi.fn(async () => []),
	getMemberCountChanges: vi.fn(async () => ({ current: 5 })),
	getPeakMemberCount: vi.fn(async () => ({ peak: 5, peakDate: null })),
	getLatestServerStats: vi.fn(async () => null),
	recordServerStats: vi.fn(),
	fetchGuildStatsFromDiscord: vi.fn(),
}));
vi.mock('$lib/log.js', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '../routes/api/stats/[guildId]/+server.js';

const GUILD = '111111111111111111';

function call(opts: { auth?: string; query?: string; guild?: string } = {}) {
	const headers: Record<string, string> = {};
	if (opts.auth) headers.Authorization = opts.auth;
	return GET({
		params: { guildId: opts.guild || GUILD },
		request: new Request('https://spacebot.test/api/stats/x', { headers }),
		url: new URL(`https://spacebot.test/api/stats/x${opts.query || ''}`),
		cookies: { get: () => undefined },
		platform: { env: { DB: {} } },
	} as any);
}

describe('GET /api/stats/[guildId] access', () => {
	beforeEach(() => {
		authState.authenticated = true;
		authState.guildId = GUILD;
		authState.scopes = ['stats:read'];
		authState.status = undefined;
		authState.error = undefined;
		adminState.authorized = false;
	});

	it('refuses a request with no key and no admin session', async () => {
		const res = await call();
		expect(res.status).toBe(401);
	});

	it('serves a key for this guild with stats:read', async () => {
		const res = await call({ auth: 'Bearer sb_live_x' });
		expect(res.status).toBe(200);
	});

	it('refuses a key that belongs to another server', async () => {
		authState.guildId = '222222222222222222';
		const res = await call({ auth: 'Bearer sb_live_x' });
		expect(res.status).toBe(403);
	});

	it('refuses a key without the stats:read scope', async () => {
		authState.scopes = ['logs:read'];
		const res = await call({ auth: 'Bearer sb_live_x' });
		expect(res.status).toBe(403);
	});

	it('passes on a bad key with the status the key check gave', async () => {
		authState.authenticated = false;
		authState.status = 401;
		authState.error = 'Invalid API key';
		const res = await call({ auth: 'Bearer sb_live_bad' });
		expect(res.status).toBe(401);
	});

	it('serves a signed-in admin of the guild', async () => {
		adminState.authorized = true;
		const res = await call();
		expect(res.status).toBe(200);
	});

	it('rejects a period it does not know', async () => {
		const res = await call({ auth: 'Bearer sb_live_x', query: '?period=banana' });
		expect(res.status).toBe(400);
	});
});
