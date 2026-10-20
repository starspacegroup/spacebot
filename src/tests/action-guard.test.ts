import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizePageMutation } from '../lib/server/action-guard.js';
import { verifyGuildAdmin, invalidateGuildCache } from '../lib/discord/guilds.js';
import { createCookieJar } from './helpers/cookie-jar.js';

const SUPERADMIN = '111111111111111111';
const USER = '333333333333333333';
const GUILD_A = '444444444444444444';
const GUILD_B = '555555555555555555';
const platform = { env: { ADMIN_USER_IDS: SUPERADMIN } };

function discordGuilds(guilds: Array<{ id: string; permissions: string }>) {
	return vi.fn(async () => new Response(JSON.stringify(guilds), { status: 200 }));
}

afterEach(() => {
	vi.unstubAllGlobals();
	invalidateGuildCache(createCookieJar() as any);
});

async function guard(method: string, pathname: string, userId: string | null, token = 'tok') {
	return authorizePageMutation({
		method,
		pathname,
		userId,
		cookies: createCookieJar({ discord_access_token: token }) as any,
		platform,
	});
}

describe('authorizePageMutation', () => {
	it('ignores GET and non-admin paths', async () => {
		expect(await guard('GET', `/admin/${GUILD_B}/api-keys`, null)).toBeNull();
		expect(await guard('POST', '/connect', null)).toBeNull();
		expect(await guard('POST', '/api/billing', null)).toBeNull();
	});

	it('anonymous action POST → 401', async () => {
		expect(
			(await guard('POST', `/admin/${GUILD_A}/api-keys?/createApiKey`, null))?.status
		).toBe(401);
	});

	it('ordinary user → 403 on superadmin actions', async () => {
		expect((await guard('POST', '/admin/superadmin/connect', USER))?.status).toBe(403);
	});

	it('wrong-guild user → 403, right-guild admin → allowed', async () => {
		vi.stubGlobal('fetch', discordGuilds([{ id: GUILD_A, permissions: '8' }]));
		expect((await guard('POST', `/admin/${GUILD_B}/api-keys`, USER, 'tok-a'))?.status).toBe(
			403
		);
		expect(await guard('POST', `/admin/${GUILD_A}/api-keys`, USER, 'tok-a')).toBeNull();
	});

	it('member without manage permission → 403', async () => {
		vi.stubGlobal('fetch', discordGuilds([{ id: GUILD_A, permissions: '0' }]));
		expect((await guard('POST', `/admin/${GUILD_A}/automations`, USER, 'tok-m'))?.status).toBe(
			403
		);
	});

	it('superadmin passes everywhere', async () => {
		expect(await guard('POST', '/admin/superadmin/connect', SUPERADMIN)).toBeNull();
		expect(await guard('POST', `/admin/${GUILD_B}/api-keys`, SUPERADMIN)).toBeNull();
	});
});

describe('guild list cache cannot be forged by cookie', () => {
	it('ignores a client-written cached_user_guilds cookie', async () => {
		vi.stubGlobal('fetch', discordGuilds([]));
		const forged = JSON.stringify({
			data: [{ id: GUILD_B, permissions: '8' }],
			timestamp: Date.now(),
		});
		const jar = createCookieJar({ discord_access_token: 'tok-f', cached_user_guilds: forged });
		const result = await verifyGuildAdmin(GUILD_B, 'tok-f', jar as any);
		expect(result.authorized).toBe(false);
	});
});

describe('actions take the guild from the route, not the form', () => {
	it('automation toggle uses params.serverId even when guild_id is forged', async () => {
		const toggleAutomation = vi.fn(async () => ({ success: true }));
		vi.doMock('$lib/db/automations.js', async (orig) => ({
			...(await orig<any>()),
			toggleAutomation,
		}));
		const { actions }: any =
			await import('../routes/admin/[serverId]/automations/+page.server.js');
		const form = new FormData();
		form.set('id', '7');
		form.set('guild_id', GUILD_B);
		form.set('enabled', 'false');
		await actions.toggle({
			request: new Request('http://x/', { method: 'POST', body: form }),
			platform: { env: { DB: {} } },
			params: { serverId: GUILD_A },
			cookies: createCookieJar(),
		});
		expect(toggleAutomation).toHaveBeenCalled();
		expect(toggleAutomation.mock.calls[0]).toContain(GUILD_A);
		expect(toggleAutomation.mock.calls[0]).not.toContain(GUILD_B);
		vi.doUnmock('$lib/db/automations.js');
	});
});
