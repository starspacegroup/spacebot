import { beforeEach, describe, expect, it, vi } from 'vitest';

const sa = { yes: true };
vi.mock('../lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: () => sa.yes }));
vi.mock('../lib/discord/commands.js', () => ({ syncGuildCommands: vi.fn(async () => ({})) }));
const updateCommand = vi.fn(async (..._args: any[]) => ({ success: true }));
const setOverride = vi.fn(async (..._args: any[]) => ({ success: true }));
vi.mock('../lib/db/commands.js', () => ({
	ACTION_TYPES: {},
	BUILT_IN_GUILD_ID: '__built_in__',
	COMMAND_TEMPLATE_VARIABLES: [],
	COMMAND_USER_SOURCES: [],
	COMMON_OPTION_TYPES: [],
	OPTION_TYPES: {},
	PERMISSION_FLAGS: {},
	PERMISSION_PRESETS: {},
	RESPONSE_TYPES: {},
	deleteCommand: vi.fn(),
	getBuiltInCommandForGuild: vi.fn(),
	getCommand: vi.fn(),
	updateCommand: (...a: any[]) => (updateCommand as any)(...a),
	setBuiltInCommandOverride: (...a: any[]) => (setOverride as any)(...a),
}));

import { actions } from '../routes/admin/[serverId]/commands/[commandId]/+page.server.js';

const G = '123456789012345678';
const run = async (fields: Record<string, string>) => {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	try {
		return await (actions as any).update({
			request: { formData: async () => form },
			platform: { env: { DB: {} } },
			params: { serverId: G, commandId: '5' },
			cookies: { get: () => 'u1' },
		});
	} catch (e: any) {
		return { redirect: e.location, status: e.status };
	}
};

beforeEach(() => {
	sa.yes = true;
	updateCommand.mockClear();
	setOverride.mockClear();
});

describe('role rules on a built-in command', () => {
	const base = { is_built_in: 'true', description: 'd', default_member_permissions: '32' };

	it('a superadmin keeps the global edit and saves the roles for this server only', async () => {
		const r = await run({
			...base,
			allow_roles: '111111111111111111',
			deny_roles: '222222222222222222',
		});
		expect(r.status).toBe(302);
		expect((updateCommand.mock.calls[0] as unknown[])[3]).toBe('__built_in__');
		// the global row never carries role ids
		expect((updateCommand.mock.calls[0] as any[])[2].access_rules).toBeUndefined();
		expect(setOverride).toHaveBeenCalledTimes(1);
		expect(setOverride.mock.calls[0].slice(1, 3)).toEqual([G, 5]);
		expect((setOverride.mock.calls[0] as any[])[3]).toEqual({
			access_rules: {
				allow_roles: ['111111111111111111'],
				deny_roles: ['222222222222222222'],
			},
		});
	});

	it('a role in both lists is denied', async () => {
		await run({ ...base, allow_roles: '111111111111111111', deny_roles: '111111111111111111' });
		expect((setOverride.mock.calls[0] as any[])[3].access_rules).toEqual({
			allow_roles: [],
			deny_roles: ['111111111111111111'],
		});
	});

	it('leaves the override alone when the form has no role fields', async () => {
		await run(base);
		expect(setOverride).not.toHaveBeenCalled();
	});

	it('a server admin still saves permission and roles as their own override', async () => {
		sa.yes = false;
		await run({ ...base, allow_roles: '111111111111111111' });
		expect(updateCommand).not.toHaveBeenCalled();
		expect((setOverride.mock.calls[0] as any[])[3]).toMatchObject({
			default_member_permissions: '32',
			access_rules: { allow_roles: ['111111111111111111'] },
		});
	});
});
