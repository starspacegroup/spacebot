import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../lib/discord/guilds.js', () => ({ verifyGuildAdmin: vi.fn() }));
vi.mock('../lib/server/feature-access.js', () => ({ mayUseFeature: vi.fn() }));

import { authorizePageMutation } from '../lib/server/action-guard.js';
import { verifyGuildAdmin } from '../lib/discord/guilds.js';
import { mayUseFeature } from '../lib/server/feature-access.js';

const G = '444444444444444444';
const post = (pathname: string) =>
	authorizePageMutation({
		method: 'POST',
		pathname,
		userId: '333333333333333333',
		cookies: { get: () => 'x' } as never,
		platform: { env: {} },
	});

describe('mutations by role', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(verifyGuildAdmin).mockResolvedValue({ authorized: false } as never);
	});

	it('lets a role holder reach their own section', async () => {
		vi.mocked(mayUseFeature).mockImplementation(async (_c, f) => f === 'logs');
		expect(await post(`/admin/${G}/logs`)).toBeNull();
		expect(await post(`/admin/${G}/logs/123`)).toBeNull();
	});

	it('asks for the feature that matches the section', async () => {
		vi.mocked(mayUseFeature).mockResolvedValue(true);
		await post(`/admin/${G}/automations/new`);
		await post(`/admin/${G}/commands/5?/delete`);
		expect(vi.mocked(mayUseFeature).mock.calls.map((c) => c[1])).toEqual([
			'automations',
			'commands',
		]);
	});

	it.each([
		'settings',
		'api-keys',
		'billing',
		'integrations',
		'import-export',
		'topics',
		'members',
		'logs-export',
		'',
	])('never lets a role holder into /%s', async (section) => {
		vi.mocked(mayUseFeature).mockResolvedValue(true);
		expect((await post(`/admin/${G}/${section}`))?.status).toBe(403);
		expect(mayUseFeature).not.toHaveBeenCalled();
	});

	it('still refuses a member whose role does not cover the section', async () => {
		vi.mocked(mayUseFeature).mockResolvedValue(false);
		expect((await post(`/admin/${G}/commands`))?.status).toBe(403);
	});
});
