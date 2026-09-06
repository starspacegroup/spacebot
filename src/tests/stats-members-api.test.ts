import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState: any = {
	authenticated: true,
	guildId: '111111111111111111',
	scopes: ['stats:read'],
	keyId: 5,
};

let rows: any[];

vi.mock('$lib/api-auth.js', () => ({
	authenticateApiKey: vi.fn(async () => authState),
	hasScope: (auth: any, scope: string) => Boolean(auth.scopes?.includes(scope)),
}));
vi.mock('$lib/db/server-stats.js', () => ({
	getServerStatsHistory: vi.fn(async () => rows),
}));
vi.mock('$lib/db/logger.js', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getServerStatsHistory } from '$lib/db/server-stats.js';
import { GET } from '../routes/api/v1/stats/members/+server.js';

function call(query = '', platform: any = { env: { DB: {} } }) {
	return GET({
		request: new Request('https://spacebot.test/api/v1/stats/members'),
		platform,
		url: new URL(`https://spacebot.test/api/v1/stats/members${query}`),
	} as any);
}

describe('GET /api/v1/stats/members', () => {
	beforeEach(() => {
		authState.authenticated = true;
		authState.scopes = ['stats:read'];
		authState.status = undefined;
		authState.error = undefined;
		vi.mocked(getServerStatsHistory).mockClear();
		rows = [
			{
				period: '2026-09-03',
				member_count: 1200,
				online_count: 80,
				bot_count: 20,
				human_count: 1180,
				last_recorded: '2026-09-03 23:10:00',
			},
			{
				period: '2026-09-04',
				member_count: 1204,
				online_count: null,
				bot_count: 20,
				human_count: null,
				last_recorded: '2026-09-04 22:55:00',
			},
		];
	});

	it('returns one point per bucket for the key’s guild, 30 days by default', async () => {
		const res = await call();
		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.guild_id).toBe('111111111111111111');
		expect(data.period).toBe('30d');
		expect(data.granularity).toBe('auto');
		expect(data.points).toEqual([
			{
				period: '2026-09-03',
				member_count: 1200,
				online_count: 80,
				human_count: 1180,
				recorded_at: '2026-09-03 23:10:00',
			},
			{
				period: '2026-09-04',
				member_count: 1204,
				online_count: null,
				human_count: null,
				recorded_at: '2026-09-04 22:55:00',
			},
		]);
		expect(getServerStatsHistory).toHaveBeenCalledWith({}, '111111111111111111', {
			period: '30d',
			granularity: 'auto',
		});
	});

	it('passes a valid period and granularity through', async () => {
		await call('?period=90d&granularity=weekly');
		expect(getServerStatsHistory).toHaveBeenCalledWith({}, '111111111111111111', {
			period: '90d',
			granularity: 'weekly',
		});
		for (const period of ['24h', '7d', '1y', 'all']) {
			expect((await call(`?period=${period}`)).status).toBe(200);
		}
	});

	it('rejects a period it would otherwise silently turn into a week', async () => {
		for (const bad of ['30', '30days', 'month', '-7d', '10000d']) {
			const res = await call(`?period=${bad}`);
			expect(res.status, bad).toBe(400);
		}
		expect(getServerStatsHistory).not.toHaveBeenCalled();
	});

	it('rejects an unknown granularity', async () => {
		expect((await call('?granularity=minutely')).status).toBe(400);
	});

	it('answers with an empty series, not an error, when nothing was recorded', async () => {
		rows = [];
		const data = await (await call()).json();
		expect(data.points).toEqual([]);
	});

	it('allows a short private cache', async () => {
		expect((await call()).headers.get('cache-control')).toBe('private, max-age=60');
	});

	it('rejects an unauthenticated request with the auth layer’s own status', async () => {
		authState.authenticated = false;
		authState.error = 'Missing Authorization header';
		authState.status = 401;
		const res = await call();
		expect(res.status).toBe(401);
		expect((await res.json()).error).toBe('Missing Authorization header');
	});

	it('rejects a key without stats:read', async () => {
		authState.scopes = ['voice:read'];
		const res = await call();
		expect(res.status).toBe(403);
		expect((await res.json()).error).toContain('stats:read');
	});

	it('reports 500 when the database binding is missing', async () => {
		expect((await call('', { env: {} })).status).toBe(500);
	});

	it('does not leak an internal error', async () => {
		vi.mocked(getServerStatsHistory).mockRejectedValueOnce(new Error('D1 exploded'));
		const res = await call();
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain('D1 exploded');
	});
});
