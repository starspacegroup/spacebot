import { describe, expect, it, vi } from 'vitest';

const top = vi.fn(async () => [
	{
		actor_id: '400000000000000001',
		actor_name: 'Riker',
		actor_avatar: null,
		actor_discriminator: '0',
		actor_is_bot: 0,
		total_seconds: 3600,
		last_active: '2026-10-25 12:00:00',
	},
]);
vi.mock('../lib/db/statistics.js', () => ({
	getTopVoiceUsers: (...a: any[]) => (top as any)(...a),
}));
vi.mock('../lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: () => true }));
vi.mock('../lib/discord/guilds.js', () => ({
	filterAdminGuilds: () => [],
	getBotGuildIds: async () => new Set(),
	getUserGuilds: async () => [],
}));

import { GET } from '../routes/api/admin/[serverId]/voice-members/+server.js';

const call = (
	serverId: string,
	query = '',
	cookies: Record<string, string> = { discord_user_id: '1', discord_access_token: 't' }
) =>
	GET({
		params: { serverId },
		cookies: { get: (k: string) => cookies[k] },
		platform: { env: { DB: {} } },
		url: new URL(`http://x/api?${query}`),
	} as any);

describe('GET voice-members', () => {
	it('lists the members with their time in voice', async () => {
		const res = await call('100000000000000001', 'period=7d');
		const body = await res.json();
		expect(top).toHaveBeenLastCalledWith({}, '100000000000000001', 500, '7d');
		expect(body.members).toEqual([
			expect.objectContaining({
				id: '400000000000000001',
				name: 'Riker',
				seconds: 3600,
				bot: false,
			}),
		]);
	});

	it('falls back to 30 days for a range it does not know', async () => {
		await call('100000000000000001', 'period=banana');
		expect(top).toHaveBeenLastCalledWith({}, '100000000000000001', 500, '30d');
	});

	it('refuses a bad server id and a signed-out caller', async () => {
		expect((await call('nope')).status).toBe(400);
		expect((await call('100000000000000001', '', {})).status).toBe(401);
	});
});
