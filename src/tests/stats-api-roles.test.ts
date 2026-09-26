import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState: any = {
	authenticated: true,
	guildId: '111111111111111111',
	scopes: ['stats:read'],
};

let roleCounts: any;

vi.mock('$lib/api-auth.js', () => ({
	authenticateApiKey: vi.fn(async () => authState),
	hasScope: (auth: any, scope: string) => Boolean(auth.scopes?.includes(scope)),
}));
vi.mock('$lib/db/logger.js', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/db/guild-cache.js', () => ({
	getRoleMemberCounts: vi.fn(async () => roleCounts),
}));

import { getRoleMemberCounts } from '$lib/db/guild-cache.js';
import { GET } from '../routes/api/v1/stats/+server.js';

/** A D1 stub: no daily rows, one snapshot. */
const db = {
	prepare: () => ({
		bind: () => ({
			all: async () => ({ results: [] }),
			first: async () => ({ member_count: 1200 }),
		}),
	}),
};

const call = () =>
	GET({
		request: new Request('https://spacebot.test/api/v1/stats'),
		platform: { env: { DB: db } },
		url: new URL('https://spacebot.test/api/v1/stats'),
	} as any);

describe('GET /api/v1/stats — role counts', () => {
	beforeEach(() => {
		authState.scopes = ['stats:read'];
		vi.mocked(getRoleMemberCounts).mockClear();
	});

	it('carries how many people hold each role, and when that was counted', async () => {
		roleCounts = {
			refreshedAt: '2026-09-26 03:00:00',
			roles: [{ role_id: '2', name: 'Passenger', member_count: 312 }],
		};
		const data = await (await call()).json();

		expect(getRoleMemberCounts).toHaveBeenCalledWith(db, '111111111111111111');
		expect(data.roles).toEqual([{ role_id: '2', name: 'Passenger', member_count: 312 }]);
		expect(data.roles_refreshed_at).toBe('2026-09-26 03:00:00');
		expect(data.current).toEqual({ member_count: 1200 });
	});

	it('sends null, not an empty list, when the counts are unknown', async () => {
		roleCounts = null;
		const data = await (await call()).json();
		expect(data.roles).toBeNull();
		expect(data.roles_refreshed_at).toBeNull();
	});

	it('still refuses a key without stats:read', async () => {
		authState.scopes = ['voice:read'];
		const res = await call();
		expect(res.status).toBe(403);
		expect(getRoleMemberCounts).not.toHaveBeenCalled();
	});
});
