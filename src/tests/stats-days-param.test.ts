import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api-auth.js', () => ({
	authenticateApiKey: vi.fn(async () => ({
		authenticated: true,
		guildId: '111111111111111111',
		scopes: ['stats:read'],
	})),
	hasScope: () => true,
}));
vi.mock('$lib/db/logger.js', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/db/guild-cache.js', () => ({ getRoleMemberCounts: vi.fn(async () => null) }));

import { GET } from '../routes/api/v1/stats/+server.js';

/** Run the route with ?days=<value> and return the LIMIT it bound. */
async function limitFor(days?: string): Promise<unknown> {
	const bound: unknown[][] = [];
	const db = {
		prepare: () => ({
			bind: (...args: unknown[]) => {
				bound.push(args);
				return { all: async () => ({ results: [] }), first: async () => null };
			},
		}),
	};
	const href = 'https://spacebot.test/api/v1/stats' + (days === undefined ? '' : `?days=${days}`);
	await GET({
		request: new Request(href),
		platform: { env: { DB: db } },
		url: new URL(href),
	} as any);
	return bound[0][1];
}

describe('GET /api/v1/stats — days', () => {
	it('defaults to 30', async () => expect(await limitFor()).toBe(30));
	it('caps at 90', async () => expect(await limitFor('500')).toBe(90));
	it('treats junk as the default, not NaN', async () => expect(await limitFor('abc')).toBe(30));
	it('never sends a negative LIMIT (no limit in SQLite)', async () => {
		expect(await limitFor('-1')).toBe(1);
		expect(await limitFor('0')).toBe(1);
	});
});
