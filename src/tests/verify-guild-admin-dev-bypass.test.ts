import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `verifyGuildAdmin`'s dev-auth bypass.
 *
 * Two independent gates, and the tests below pin both:
 *
 * - SvelteKit's build-time `dev` flag, so the branch is statically absent from
 *   a production bundle rather than resting on a runtime string comparison.
 * - The `dev_mock_token` sentinel, so only a session minted by /dev-login gets
 *   the bypass — a real Discord token still goes through the real check even in
 *   dev.
 *
 * The previous gate read `process.env.DEV_AUTH_BYPASS` directly, which never
 * matched under `vite dev` (env reaches the SvelteKit runtime via
 * `platform.env`), so every guild-scoped API 403'd locally.
 */

const getUserGuilds = vi.fn();

function cookies(role?: string) {
	return { get: (name: string) => (name === 'dev_auth_role' ? role : undefined) } as any;
}

/** Import the module with `dev` forced to a given value. */
async function loadWithDev(isDev: boolean) {
	vi.resetModules();
	vi.doMock('$app/environment', () => ({ dev: isDev, browser: false, building: false }));
	return await import('../lib/discord/guilds.js');
}

beforeEach(() => {
	getUserGuilds.mockReset();
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [{ id: 'real-guild', permissions: '8' }],
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.doUnmock('$app/environment');
	vi.resetModules();
});

describe('verifyGuildAdmin dev bypass', () => {
	it('authorizes any guild for a dev-auth session in a dev build', async () => {
		const { verifyGuildAdmin }: any = await loadWithDev(true);

		// A guild id that Discord would never return for this user — exactly the
		// case `bun run db:seed:dev` produces.
		const result = await verifyGuildAdmin(
			'90000000000000001',
			'dev_mock_token',
			cookies('superadmin')
		);

		expect(result.authorized).toBe(true);
		expect(result.guild).toMatchObject({ id: '90000000000000001' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('honors the dev role — a plain user is not an admin', async () => {
		const { verifyGuildAdmin }: any = await loadWithDev(true);

		const result = await verifyGuildAdmin(
			'90000000000000001',
			'dev_mock_token',
			cookies('user')
		);

		expect(result.authorized).toBe(false);
		expect(result.error).toBe('Insufficient permissions');
	});

	it('does NOT bypass in a dev build when the token is a real one', async () => {
		const { verifyGuildAdmin }: any = await loadWithDev(true);

		const result = await verifyGuildAdmin(
			'90000000000000001',
			'a-real-discord-token',
			cookies('superadmin')
		);

		// Falls through to the real check, which asks Discord and does not find it.
		expect(result.authorized).toBe(false);
		expect(fetch).toHaveBeenCalled();
	});

	it('does NOT bypass in a production build, even with the mock token and role', async () => {
		const { verifyGuildAdmin }: any = await loadWithDev(false);

		const result = await verifyGuildAdmin(
			'90000000000000001',
			'dev_mock_token',
			cookies('superadmin')
		);

		expect(result.authorized).toBe(false);
		expect(result.guild).toBeUndefined();
	});

	it('still rejects a missing token or guild id before any gate', async () => {
		const { verifyGuildAdmin }: any = await loadWithDev(true);

		await expect(verifyGuildAdmin('', 'dev_mock_token', cookies())).resolves.toMatchObject({
			authorized: false,
			error: 'Unauthorized',
		});
		await expect(verifyGuildAdmin('90000000000000001', '', cookies())).resolves.toMatchObject({
			authorized: false,
			error: 'Unauthorized',
		});
	});
});
