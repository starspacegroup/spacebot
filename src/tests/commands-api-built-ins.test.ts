import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/commands` used to select on `guild_id = auth.guildId` alone, which
 * misses every built-in: those live under the reserved `__built_in__` guild.
 * A server with no custom commands got an empty list, which is exactly the
 * server most likely to be asking what commands exist.
 */

let auth: any = { authenticated: true, guildId: 'g1', scopes: ['commands:read'] };

vi.mock('$lib/api-auth.js', () => ({
	authenticateApiKey: async () => auth,
	hasScope: (a: any, scope: string) => Boolean(a?.scopes?.includes(scope)),
}));
vi.mock('$lib/db/logger.js', () => ({ log: { error: () => {}, info: () => {}, warn: () => {} } }));

let builtIns: any[] = [];
let guildCommands: any[] = [];
let builtInsThrow = false;

vi.mock('$lib/db/commands.js', () => ({
	getBuiltInCommandsForGuild: async () => {
		if (builtInsThrow) throw new Error('boom');
		return builtIns;
	},
	getGuildCommands: async () => guildCommands,
}));

const { GET } = await import('../routes/api/v1/commands/+server.js');

const event = (query = '') => ({
	request: new Request('https://bot.test/api/v1/commands'),
	platform: { env: { DB: {} } },
	url: new URL(`https://bot.test/api/v1/commands${query}`),
});

const cmd = (name: string, is_built_in = false) => ({
	name,
	description: `${name} does a thing`,
	is_built_in,
});

beforeEach(() => {
	auth = { authenticated: true, guildId: 'g1', scopes: ['commands:read'] };
	builtIns = [cmd('stats', true), cmd('help', true), cmd('ping', true)];
	guildCommands = [cmd('welcome'), cmd('archive')];
	builtInsThrow = false;
});

describe('GET /api/v1/commands', () => {
	it('refuses a key without commands:read', async () => {
		auth = { authenticated: true, guildId: 'g1', scopes: ['voice:read'] };
		expect((await GET(event() as any)).status).toBe(403);
	});

	it('returns built-ins and custom commands together, built-ins first', async () => {
		const body = await (await GET(event() as any)).json();
		expect(body.total).toBe(5);
		expect(body.commands.map((c: any) => c.name)).toEqual([
			'help',
			'ping',
			'stats',
			'archive',
			'welcome',
		]);
	});

	it('still answers on a server that has defined nothing of its own', async () => {
		guildCommands = [];
		const body = await (await GET(event() as any)).json();
		expect(body.total).toBe(3);
		expect(body.commands.every((c: any) => c.is_built_in)).toBe(true);
	});

	it('marks which commands are built in', async () => {
		const body = await (await GET(event() as any)).json();
		const byName = Object.fromEntries(body.commands.map((c: any) => [c.name, c.is_built_in]));
		expect(byName.ping).toBe(true);
		expect(byName.welcome).toBe(false);
	});

	it('can serve one half or the other', async () => {
		const only = await (await GET(event('?built_in=only') as any)).json();
		expect(only.commands.map((c: any) => c.name)).toEqual(['help', 'ping', 'stats']);

		const without = await (await GET(event('?built_in=exclude') as any)).json();
		expect(without.commands.map((c: any) => c.name)).toEqual(['archive', 'welcome']);
	});

	it('paginates across both halves rather than within each', async () => {
		const first = await (await GET(event('?limit=2') as any)).json();
		expect(first.commands.map((c: any) => c.name)).toEqual(['help', 'ping']);
		expect(first.total).toBe(5);

		const second = await (await GET(event('?limit=2&offset=2') as any)).json();
		expect(second.commands.map((c: any) => c.name)).toEqual(['stats', 'archive']);
	});

	it('caps the page size', async () => {
		const body = await (await GET(event('?limit=5000') as any)).json();
		expect(body.limit).toBe(100);
	});

	it('reports a read failure rather than a partial list', async () => {
		builtInsThrow = true;
		expect((await GET(event() as any)).status).toBe(500);
	});

	it('reports a missing database', async () => {
		const response = await GET({ ...event(), platform: { env: {} } } as any);
		expect(response.status).toBe(500);
	});
});
