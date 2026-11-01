import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	result: { success: true, registered: 4 } as any,
	status: null as any,
}));
vi.mock('$lib/discord/commands.js', () => ({
	syncGuildCommands: async () => ({ success: true }),
	syncGuildCommandsNow: async () => h.result,
	getCommandSyncStatus: async () => h.status,
}));
vi.mock('$lib/db/commands.js', () => ({
	ACTION_TYPES: [],
	COMMAND_TEMPLATE_VARIABLES: [],
	COMMON_OPTION_TYPES: [],
	OPTION_TYPES: [],
	RESPONSE_TYPES: [],
	deleteCommand: async () => ({ success: true }),
	getBuiltInCommandsForGuild: async () => [],
	getCommandLogs: async () => [],
	getGuildCommands: async () => [],
}));
vi.mock('$lib/server/control-actions.js', () => ({
	setCommandEnabled: async () => ({ ok: true }),
}));
vi.mock('$lib/db/logger.js', () => ({ log: { error: () => {} } }));

const { actions, load } = await import('../routes/admin/[serverId]/commands/+page.server.js');
const GUILD = '1009583217948491928';
const platform = { env: { DB: {} } };

describe('Commands page sync', () => {
	it('loads the guild sync status', async () => {
		h.status = { syncedAt: '2026-11-01 00:00:00', attemptedAt: null, lastError: null };
		const data: any = await load({
			platform,
			params: { serverId: GUILD },
			parent: async () => ({ adminGuilds: [{ id: GUILD }], isSuperAdmin: false }),
		} as any);
		expect(data.commandSync).toEqual(h.status);
	});

	it('syncs now and reports how many went', async () => {
		h.result = { success: true, registered: 4 };
		expect(await actions.sync({ platform, params: { serverId: GUILD } } as any)).toEqual({
			success: true,
			synced: 4,
		});
		h.result = { success: true };
		expect(await actions.sync({ platform, params: { serverId: GUILD } } as any)).toEqual({
			success: true,
			synced: 0,
		});
	});

	it('fails with the Discord error, or without a db', async () => {
		h.result = { success: false, error: 'Missing Access' };
		const r: any = await actions.sync({ platform, params: { serverId: GUILD } } as any);
		expect(r.status).toBe(502);
		expect(r.data.error).toBe('Missing Access');
		h.result = { success: false };
		const r3: any = await actions.sync({ platform, params: { serverId: GUILD } } as any);
		expect(r3.data.error).toBe('Sync failed');
		const r2: any = await actions.sync({
			platform: { env: {} },
			params: { serverId: GUILD },
		} as any);
		expect(r2.status).toBe(500);
	});
});
