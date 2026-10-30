import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/discord/guilds/[guildId]/members` passes `?limit=` on to Discord. A junk,
 * zero or negative value used to go through as `NaN`, `0` or a negative number
 * and Discord refused the call, so the member picker came up empty.
 */

vi.mock('$lib/db/logger.js', () => ({ log: { error: () => {}, info: () => {}, warn: () => {} } }));
vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: async () => ({ authorized: true }),
}));

import { GET } from '../routes/api/discord/guilds/[guildId]/members/+server.js';

async function askedLimit(query: string): Promise<string | null> {
	let seen: string | null = null;
	vi.stubGlobal('fetch', async (input: string) => {
		seen = new URL(input).searchParams.get('limit');
		return new Response('[]', { status: 200 });
	});
	await (GET as any)({
		params: { guildId: 'g1' },
		cookies: { get: () => 'tok' },
		platform: { env: { DISCORD_BOT_TOKEN: 'bot' } },
		url: new URL(`http://localhost/api/discord/guilds/g1/members${query}`),
	});
	return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('guild members ?limit=', () => {
	it('defaults to 100', async () => {
		expect(await askedLimit('')).toBe('100');
	});
	it('falls back to 100 for junk', async () => {
		expect(await askedLimit('?limit=abc')).toBe('100');
	});
	it('raises zero and negatives to 1', async () => {
		expect(await askedLimit('?limit=0')).toBe('1');
		expect(await askedLimit('?limit=-5')).toBe('1');
	});
	it('caps at 1000', async () => {
		expect(await askedLimit('?limit=5000')).toBe('1000');
	});
	it('keeps a sound value, on search too', async () => {
		expect(await askedLimit('?limit=50')).toBe('50');
		expect(await askedLimit('?query=bob&limit=7')).toBe('7');
	});
});
