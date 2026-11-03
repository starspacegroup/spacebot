import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/discord/guilds.js', () => ({
	getUserGuilds: vi.fn(async () => [
		{ id: '111111111111111111', name: 'Mine', owner: true, permissions: '0', icon: null },
		{ id: '222222222222222222', name: 'Not admin', owner: false, permissions: '0', icon: null },
		{ id: '333333333333333333', name: 'No bot', owner: true, permissions: '0', icon: null },
	]),
	getBotGuildIds: vi.fn(async () => new Set(['111111111111111111', '222222222222222222'])),
	filterAdminGuilds: (guilds: any[]) => guilds.filter((g) => g.owner),
}));

import { getManageableGuilds } from '$lib/server/manageable-guilds.js';

const cookies = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
const platform = { env: { DISCORD_BOT_TOKEN: 'bot' } };

describe('getManageableGuilds', () => {
	it('returns only servers the visitor manages and the bot is in', async () => {
		const result = await getManageableGuilds(
			cookies({ discord_user_id: '1', discord_access_token: 't' }),
			platform
		);
		expect(result).toEqual([{ id: '111111111111111111', name: 'Mine' }]);
	});

	it('returns nothing for a signed-out visitor', async () => {
		expect(await getManageableGuilds(cookies({}), platform)).toEqual([]);
	});

	it('returns nothing when the bot token is missing', async () => {
		const result = await getManageableGuilds(
			cookies({ discord_user_id: '1', discord_access_token: 't' }),
			{ env: {} }
		);
		expect(result).toEqual([]);
	});
});
