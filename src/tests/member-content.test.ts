import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { handleAboutCommand } from '../lib/server/member-content.js';

let auth: any = { authenticated: true, guildId: 'g1', scopes: ['content:read'] };
vi.mock('$lib/api-auth.js', () => ({
	authenticateApiKey: async () => auth,
	hasScope: (a: any, scope: string) => Boolean(a?.scopes?.includes(scope)),
}));
vi.mock('$lib/db/logger.js', () => ({ log: { error: () => {}, info: () => {}, warn: () => {} } }));

const { GET } = await import('../routes/api/v1/member-content/+server.js');

const MIGRATION = readFileSync(
	new URL('../../migrations/0078_member_content.sql', import.meta.url),
	'utf8'
);
// The tables only; the seeded command row needs the full commands table.
const SCHEMA = MIGRATION.replace(/INSERT OR IGNORE INTO commands[\s\S]*$/, '');

let db: any;
beforeEach(() => {
	db = createSqliteD1(SCHEMA);
	auth = { authenticated: true, guildId: 'g1', scopes: ['content:read'] };
});

const call = (sub: string, opts: any[], member: any = {}, guild = 'g1') =>
	handleAboutCommand(
		{
			guild_id: guild,
			member: { user: { id: 'u1' }, roles: [], permissions: '0', ...member },
			data: { name: 'about', options: [{ name: sub, options: opts }] },
		},
		db
	);
const text = (v: string) => [{ name: 'text', value: v }];
const roleOpt = [{ name: 'role', value: 'r1' }];
const admin = { permissions: String(1 << 5) };
const writer = { roles: ['r1'] };

describe('/about', () => {
	it('refuses writing until an admin sets a role', async () => {
		const res = await call('set', text('hi'), writer);
		expect(res.data.content).toContain('No contributor role');
	});

	it('lets only Manage Server choose the role', async () => {
		expect((await call('role', roleOpt)).data.content).toContain('Only members who can manage');
		expect((await call('role', roleOpt, admin)).data.content).toContain('<@&r1>');
	});

	it('sets, shows and clears for a member with the role, and pings nobody', async () => {
		await call('role', roleOpt, admin);
		await call('set', text('Hello @everyone'), writer);
		const shown = await call('show', []);
		expect(shown.data.content).toContain('Hello @everyone');
		expect(shown.data.allowed_mentions).toEqual({ parse: [] });
		expect((await call('clear', [], writer)).data.content).toContain('cleared');
		expect((await call('show', [])).data.content).toContain('has not set anything');
	});

	it('refuses a member without the role, and one whose role was removed', async () => {
		await call('role', roleOpt, admin);
		expect((await call('set', text('x'), { roles: ['other'] })).data.content).toContain(
			'contributor role'
		);
		await call('set', text('x'), writer);
		expect((await call('clear', [], { roles: [] })).data.content).toContain('contributor role');
		expect((await call('show', [])).data.content).toContain('x');
	});

	it('refuses text over 500 characters', async () => {
		await call('role', roleOpt, admin);
		expect((await call('set', text('a'.repeat(501)), writer)).data.content).toContain('500');
	});

	it('keeps servers apart', async () => {
		await call('role', roleOpt, admin);
		await call('set', text('mine'), writer);
		expect((await call('show', [], {}, 'g2')).data.content).toContain('has not set anything');
	});
});

describe('GET /api/v1/member-content', () => {
	const ev = (query = '') => ({
		request: new Request('https://bot.test/api/v1/member-content'),
		platform: { env: { DB: db } },
		url: new URL('https://bot.test/api/v1/member-content' + query),
	});

	it('refuses a key without content:read', async () => {
		auth = { authenticated: true, guildId: 'g1', scopes: ['voice:read'] };
		expect((await GET(ev() as any)).status).toBe(403);
	});

	it('lists this guild only, and fetches one member or 404s', async () => {
		await call('role', roleOpt, admin);
		await call('set', text('mine'), writer);
		db.exec(
			"INSERT INTO member_content (guild_id, user_id, content) VALUES ('g2','u9','other')"
		);
		const list = await (await GET(ev() as any)).json();
		expect(list.entries.map((e: any) => e.user_id)).toEqual(['u1']);
		const one = await (await GET(ev('?user_id=u1') as any)).json();
		expect(one.content).toBe('mine');
		expect((await GET(ev('?user_id=u9') as any)).status).toBe(404);
	});
});

describe('migration', () => {
	it('seeds /about as an enabled built-in with four subcommands', () => {
		expect(MIGRATION).toContain("'__built_in__', 'about'");
		const m = /\n    '(\[\{"name":"set".*?\}\])',\n/s.exec(MIGRATION)!;
		const options = JSON.parse(m[1]);
		expect(options.map((o: any) => o.name)).toEqual(['set', 'clear', 'show', 'role']);
	});
});
