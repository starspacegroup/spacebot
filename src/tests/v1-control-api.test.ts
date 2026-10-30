import { beforeEach, describe, expect, it, vi } from 'vitest';

// The key under test belongs to GUILD; OTHER is someone else's server.
const GUILD = '100000000000000001';
const OTHER = '200000000000000002';
const CHANNEL = '300000000000000003';
const FOREIGN_CHANNEL = '300000000000000999';

let scopes: string[] = [];
vi.mock('../lib/api-auth.js', () => ({
	authenticateApiKey: async () => ({ authenticated: true, guildId: GUILD, scopes, keyId: 7 }),
	hasScope: (auth: any, s: string) => auth.scopes.includes(s),
}));

// Rows live in one guild only; lookups are guild-scoped like the real queries.
const automations = [
	{ id: 11, guild_id: OTHER, name: 'theirs' },
	{ id: 12, guild_id: GUILD, name: 'ours' },
];
const commands = [
	{ id: 21, guild_id: OTHER, name: 'theirs', is_built_in: false },
	{ id: 22, guild_id: GUILD, name: 'ours', is_built_in: false },
	{ id: 23, guild_id: GUILD, name: 'help', is_built_in: true },
];
const toggleAutomation = vi.fn(async () => ({ success: true }));
const updateCommand = vi.fn(async () => ({ success: true }));
const setBuiltInCommandOverride = vi.fn(async () => ({ success: true }));
const createScheduledMessage = vi.fn(async (_db: any, p: any) => ({
	success: true,
	id: 99,
	send_at: p.send_at,
}));
const syncGuildCommands = vi.fn(async () => ({}));
const logEvent = vi.fn(async () => ({ success: true }));

vi.mock('../lib/db/automations.js', () => ({
	getAutomation: async (_db: any, id: any, g: string) =>
		automations.find((a) => String(a.id) === String(id) && a.guild_id === g) || null,
	getAutomations: async () => ({ automations: [] }),
	toggleAutomation: (...a: any[]) => (toggleAutomation as any)(...a),
}));
vi.mock('../lib/db/commands.js', () => ({
	getCommand: async (_db: any, id: any, g: string) =>
		commands.find((c) => c.id === id && c.guild_id === g) || null,
	getGuildCommands: async () => [],
	updateCommand: (...a: any[]) => (updateCommand as any)(...a),
	setBuiltInCommandOverride: (...a: any[]) => (setBuiltInCommandOverride as any)(...a),
}));
vi.mock('../lib/db/scheduled-messages.js', () => ({
	createScheduledMessage: (...a: any[]) => (createScheduledMessage as any)(...a),
}));
vi.mock('../lib/db/guild-channels.js', () => ({
	getGuildChannels: async (_db: any, g: string) => (g === GUILD ? [{ channelId: CHANNEL }] : []),
}));
vi.mock('../lib/db/server-plans.js', () => ({ checkPlanLimit: async () => ({ allowed: true }) }));
vi.mock('../lib/discord/commands.js', () => ({
	syncGuildCommands: (...a: any[]) => (syncGuildCommands as any)(...a),
}));
vi.mock('../lib/db/logger.js', () => ({
	log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
	logEvent: (...a: any[]) => (logEvent as any)(...a),
}));

import { PATCH as patchAutomation } from '../routes/api/v1/automations/[id]/+server.js';
import { PATCH as patchCommand } from '../routes/api/v1/commands/[id]/+server.js';
import { POST as postScheduled } from '../routes/api/v1/scheduled-messages/+server.js';
import { POST as mcp } from '../routes/api/v1/mcp/+server.js';

const db = {
	prepare: () => ({ bind: () => ({ first: async () => ({ name: 'Computer' }) }) }),
};
const platform = { env: { DB: db } };
const req = (body: any) =>
	new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) });
const future = () => new Date(Date.now() + 3600_000).toISOString();

const callMcp = async (name: string, args: any) => {
	const res = await mcp({
		request: req({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name, arguments: args },
		}),
		platform,
	} as any);
	return (await res.json()).result;
};

beforeEach(() => {
	scopes = ['automations:write', 'commands:write', 'messages:write'];
	vi.clearAllMocks();
});

describe('PATCH /api/v1/automations/:id', () => {
	const call = (id: string, body: any) =>
		patchAutomation({ request: req(body), platform, params: { id } } as any);

	it('refuses a key without automations:write', async () => {
		scopes = ['automations:read'];
		expect((await call('12', { enabled: false })).status).toBe(403);
		expect(toggleAutomation).not.toHaveBeenCalled();
	});

	it("refuses another guild's automation", async () => {
		expect((await call('11', { enabled: false })).status).toBe(404);
		expect(toggleAutomation).not.toHaveBeenCalled();
	});

	it('toggles its own automation and logs the key', async () => {
		const res = await call('12', { enabled: false });
		expect(res.status).toBe(200);
		expect(toggleAutomation).toHaveBeenCalledWith(db, '12', GUILD, false);
		expect(logEvent).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				guild_id: GUILD,
				event_type: 'API_AUTOMATION_TOGGLED',
				actor_id: 'api_key:7',
				actor_name: 'Computer',
			})
		);
	});

	it('refuses a body without a boolean enabled', async () => {
		expect((await call('12', { enabled: 'yes' })).status).toBe(400);
	});
});

describe('PATCH /api/v1/commands/:id', () => {
	const call = (id: string, body: any) =>
		patchCommand({ request: req(body), platform, params: { id } } as any);

	it('refuses a key without commands:write', async () => {
		scopes = ['commands:read'];
		expect((await call('22', { enabled: true })).status).toBe(403);
	});

	it("refuses another guild's command", async () => {
		expect((await call('21', { enabled: true })).status).toBe(404);
		expect(updateCommand).not.toHaveBeenCalled();
	});

	it('toggles a built-in as a per-guild override, never the shared row', async () => {
		expect((await call('23', { enabled: false })).status).toBe(200);
		expect(setBuiltInCommandOverride).toHaveBeenCalledWith(db, GUILD, 23, { enabled: false });
		expect(updateCommand).not.toHaveBeenCalled();
	});

	it('toggles its own command, syncs to Discord and logs the key', async () => {
		const res = await call('22', { enabled: true });
		expect(res.status).toBe(200);
		expect(updateCommand).toHaveBeenCalledWith(db, 22, { enabled: true }, GUILD);
		expect(syncGuildCommands).toHaveBeenCalledWith(db, GUILD, platform.env);
		expect(logEvent).toHaveBeenCalledWith(
			db,
			expect.objectContaining({ event_type: 'API_COMMAND_TOGGLED', actor_id: 'api_key:7' })
		);
	});
});

describe('POST /api/v1/scheduled-messages', () => {
	const call = (body: any) => postScheduled({ request: req(body), platform } as any);

	it('refuses a key without messages:write', async () => {
		scopes = ['commands:write'];
		expect((await call({ channel_id: CHANNEL, content: 'hi', send_at: future() })).status).toBe(
			403
		);
	});

	it("refuses a channel outside the key's guild", async () => {
		const res = await call({ channel_id: FOREIGN_CHANNEL, content: 'hi', send_at: future() });
		expect(res.status).toBe(403);
		expect(createScheduledMessage).not.toHaveBeenCalled();
	});

	it('schedules a message in its own channel and logs the key', async () => {
		const send_at = future();
		const res = await call({ channel_id: CHANNEL, content: 'hello', send_at });
		expect(res.status).toBe(201);
		expect(createScheduledMessage).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				guild_id: GUILD,
				channel_id: CHANNEL,
				action_type: 'SEND_MESSAGE',
				message_payload: { content: 'hello' },
				send_at,
				created_by: 'api_key:7',
			})
		);
		expect(logEvent).toHaveBeenCalledWith(
			db,
			expect.objectContaining({ event_type: 'API_MESSAGE_SCHEDULED', actor_id: 'api_key:7' })
		);
	});
});

describe('MCP write tools', () => {
	it('lists write tools only for keys holding the write scope', async () => {
		scopes = ['automations:read'];
		const res = await mcp({
			request: req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			platform,
		} as any);
		const names = (await res.json()).result.tools.map((t: any) => t.name);
		expect(names).toContain('get_automations');
		expect(names).not.toContain('set_automation_enabled');
		expect(names).not.toContain('schedule_message');
	});

	it('refuses a call without the scope', async () => {
		scopes = [];
		const result = await callMcp('set_command_enabled', { id: 22, enabled: true });
		expect(result.isError).toBe(true);
		expect(updateCommand).not.toHaveBeenCalled();
	});

	it("refuses another guild's automation", async () => {
		const result = await callMcp('set_automation_enabled', { id: '11', enabled: true });
		expect(result.isError).toBe(true);
		expect(toggleAutomation).not.toHaveBeenCalled();
	});

	it('runs all three writes through the shared functions', async () => {
		expect(
			(await callMcp('set_automation_enabled', { id: '12', enabled: true })).isError
		).toBeUndefined();
		expect(
			(await callMcp('set_command_enabled', { id: 22, enabled: false })).isError
		).toBeUndefined();
		expect(
			(
				await callMcp('schedule_message', {
					channel_id: CHANNEL,
					content: 'hi',
					send_at: future(),
				})
			).isError
		).toBeUndefined();
		expect(toggleAutomation).toHaveBeenCalledWith(db, '12', GUILD, true);
		expect(updateCommand).toHaveBeenCalledWith(db, 22, { enabled: false }, GUILD);
		expect(createScheduledMessage).toHaveBeenCalled();
		expect(logEvent).toHaveBeenCalledTimes(3);
	});
});
