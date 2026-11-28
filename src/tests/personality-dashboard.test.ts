import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

const auth = { ok: true };
vi.mock('../lib/discord/guilds.js', () => ({
	verifyGuildAdmin: async () => (auth.ok ? { authorized: true } : { authorized: false }),
}));
const setEnabled = vi.fn(async (..._a: any[]) => ({ ok: true }));
vi.mock('../lib/server/control-actions.js', () => ({
	setCommandEnabled: (...a: any[]) => (setEnabled as any)(...a),
}));
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: async () => ({ name: 'personality' }),
	getBuiltInCommandsForGuild: async () => [{ id: 9, name: 'personality', enabled: false }],
}));

import { actions, load } from '../routes/admin/[serverId]/personality/+page.server.js';
import { TESTS } from '../lib/server/personality-tests.js';

const SCHEMA = `
CREATE TABLE personality_hidden (guild_id TEXT NOT NULL, test_id TEXT NOT NULL, hidden_by TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (guild_id, test_id));
CREATE TABLE personality_custom (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
	name TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'hubs', note TEXT,
	added_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`;
const G = '123456789012345678';

let db: any;
const event = (fields: [string, string][]) => {
	const form = {
		get: (k: string) => fields.find(([n]) => n === k)?.[1] ?? null,
		getAll: (k: string) => fields.filter(([n]) => n === k).map(([, v]) => v),
		has: (k: string) => fields.some(([n]) => n === k),
	};
	return {
		request: { formData: async () => form as any },
		cookies: { get: (k: string) => ({ discord_access_token: 't', discord_user_id: 'u9' })[k] },
		platform: { env: { DB: db } },
		params: { serverId: G },
	} as any;
};
const hiddenIds = async () =>
	(
		(
			await db
				.prepare('SELECT test_id FROM personality_hidden WHERE guild_id = ?')
				.bind(G)
				.all()
		).results as any[]
	).map((r) => r.test_id);

beforeEach(() => {
	auth.ok = true;
	setEnabled.mockClear();
	db = createSqliteD1(SCHEMA);
});

describe('personality dashboard', () => {
	it('loads the catalog, the command and what the server chose', async () => {
		await actions.selection(
			event(TESTS.filter((t) => t.id !== 'bdsm-test').map((t) => ['shown', t.id]))
		);
		const data: any = await load({
			platform: { env: { DB: db } },
			parent: async () => ({ adminGuilds: [{ id: G }] }),
			params: { serverId: G },
		} as any);
		expect(data.available).toBe(true);
		expect(data.commandId).toBe(9);
		expect(data.catalog).toHaveLength(TESTS.length);
		expect(data.hidden).toEqual(['bdsm-test']);
	});

	it('sends non-admins away', async () => {
		await expect(
			load({
				platform: { env: { DB: db } },
				parent: async () => ({ adminGuilds: [] }),
				params: { serverId: G },
			} as any)
		).rejects.toMatchObject({ status: 302 });
	});

	it('hides whatever is not ticked, and ignores ids that are not in the catalog', async () => {
		const keep = TESTS.slice(2).map((t) => ['shown', t.id] as [string, string]);
		const r: any = await actions.selection(event([...keep, ['shown', 'made-up']]));
		expect(r.success).toBe(true);
		expect((await hiddenIds()).sort()).toEqual([TESTS[0].id, TESTS[1].id].sort());
		expect(await hiddenIds()).not.toContain('made-up');
	});

	it('ticking every box shows everything', async () => {
		await actions.selection(event([]));
		expect(await hiddenIds()).toHaveLength(TESTS.length);
		await actions.selection(event(TESTS.map((t) => ['shown', t.id])));
		expect(await hiddenIds()).toEqual([]);
	});

	it('show every test clears the hidden list', async () => {
		await actions.selection(event([]));
		await actions.showall(event([]));
		expect(await hiddenIds()).toEqual([]);
	});

	it('adds and removes an own link, refusing bad ones', async () => {
		const bad: any = await actions.add(
			event([
				['name', 'x'],
				['url', 'http://nope.example'],
			])
		);
		expect(bad.status).toBe(400);
		const ok: any = await actions.add(
			event([
				['name', 'Ours'],
				['url', 'https://example.com/ours'],
				['category', 'fun'],
			])
		);
		expect(ok.success).toBe(true);
		const row = await db.prepare('SELECT id, category FROM personality_custom').first();
		expect(row.category).toBe('fun');
		expect(((await actions.remove(event([['id', String(row.id)]]))) as any).success).toBe(true);
		expect(((await actions.remove(event([['id', String(row.id)]]))) as any).status).toBe(404);
	});

	it('every write needs Manage Server', async () => {
		auth.ok = false;
		for (const name of ['enable', 'selection', 'showall', 'add', 'remove'] as const) {
			const r: any = await (actions as any)[name](
				event([
					['name', 'a'],
					['url', 'https://example.com'],
				])
			);
			expect(r.status).toBe(403);
		}
		expect(await hiddenIds()).toEqual([]);
		expect(setEnabled).not.toHaveBeenCalled();
	});

	it('turns the command on through the shared switch', async () => {
		await actions.enable(
			event([
				['command_id', '9'],
				['enabled', 'on'],
			])
		);
		expect(setEnabled).toHaveBeenCalledWith(db, expect.anything(), G, 9, true);
	});
});
