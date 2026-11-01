/**
 * The Games section of the Activity admin page is drawn from one registry.
 * These tests hold the registry to its own rules, and check that each game's
 * switch reads and writes the storage it always used.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

const commands = { list: [] as any[], set: vi.fn(async () => ({ success: true })) };
const sync = vi.fn();
let superadmin = true;
vi.mock('$lib/db/logger.js', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/db/commands.js', () => ({
	getBuiltInCommandsForGuild: vi.fn(async () => commands.list),
	setBuiltInCommandOverride: (...a: unknown[]) => (commands.set as any)(...a),
}));
vi.mock('$lib/discord/commands.js', () => ({ syncGuildCommands: (...a: any[]) => sync(...a) }));
vi.mock('$lib/discord/guilds.js', () => ({
	hasFullAdminPermission: () => true,
	verifyGuildAdmin: async () => ({ authorized: true, guild: { permissions: '8' } }),
}));
vi.mock('$lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: () => superadmin }));

const { GAMES, findGame, gameCommands, registryProblems } =
	await import('../lib/games/registry.js');
const { loadGameStates, setGameEnabled } = await import('../lib/server/games-admin.js');
const { actions } = await import('../routes/admin/[serverId]/activity/+page.server.js');
const shiritori = await import('../lib/server/shiritori-game.js');
const { ACTIVITY_MODULES } = await import('../lib/server/activity.js');

const SCHEMA = readFileSync(
	new URL('../../migrations/0081_shiritori.sql', import.meta.url),
	'utf8'
).split('-- `/play shiritori` joins')[0];
const G = '100000000000000001';

let db: ReturnType<typeof createSqliteD1>;
beforeEach(() => {
	db = createSqliteD1(SCHEMA);
	commands.list = [{ id: 'cmd-play', name: 'play', enabled: true }];
	commands.set = vi.fn(async () => ({ success: true }));
	sync.mockClear();
	superadmin = true;
});

describe('the game registry', () => {
	it('has no problems, and lists Hidden Agent and Shiritori', () => {
		expect(registryProblems(GAMES)).toEqual([]);
		expect(GAMES.map((g) => g.id)).toEqual(['agent', 'shiritori']);
	});

	it('keeps the switches the page always used', () => {
		expect(findGame('agent')?.enable).toEqual({ kind: 'command', command: 'play' });
		expect(findGame('shiritori')?.enable).toEqual({ kind: 'setting', store: 'shiritori' });
		// The Activity's `game` module is the same command as the agent game.
		expect(ACTIVITY_MODULES.find((m) => m.id === 'game')?.command).toBe('play');
	});

	it('names each game a doc that exists', () => {
		for (const g of GAMES) expect(() => readFileSync(`docs/${g.doc}`)).not.toThrow();
	});

	it('finds by id only', () => {
		expect(findGame('nope')).toBeUndefined();
		expect(findGame(42)).toBeUndefined();
		expect(findGame(null)).toBeUndefined();
	});

	it('knows which commands are game switches', () => {
		expect([...gameCommands()]).toEqual(['play']);
		expect(gameCommands([])).toEqual(new Set());
	});

	it('reports the mistakes a new entry could make', () => {
		const base = GAMES[0];
		const problems = registryProblems([
			{ ...base, id: 'Bad Id' },
			base,
			base,
			{ ...base, id: 'blank', name: '' },
			{ ...base, id: 'noswitch', enable: undefined },
			{ ...base, id: 'planned', status: 'planned' },
			{ ...base, id: 'cmd', commands: ['play'] },
		]);
		expect(problems).toEqual([
			'Bad Id: id is not a slug',
			'agent: duplicate id',
			'blank: name, tagline, players and where are required',
			'noswitch: a live game needs a switch',
			'planned: a planned game has no switch yet',
			'cmd: command "play" must start with /',
		]);
		expect(
			registryProblems([{ ...base, id: 'soon', status: 'planned', enable: undefined }])
		).toEqual([]);
	});
});

describe('loadGameStates', () => {
	it('reads a command switch and a setting switch', async () => {
		await shiritori.upsertSettings(db, G, { ...shiritori.DEFAULTS, enabled: true });
		const states = await loadGameStates(db, G, [{ name: 'play', enabled: true }]);
		expect(states).toEqual([
			{ id: 'agent', enabled: true, blockedBy: null },
			{ id: 'shiritori', enabled: true, blockedBy: null },
		]);
	});

	it('flags Shiritori when /play is off, and only when Shiritori is on', async () => {
		await shiritori.upsertSettings(db, G, { ...shiritori.DEFAULTS, enabled: true });
		expect((await loadGameStates(db, G, []))[1]).toEqual({
			id: 'shiritori',
			enabled: true,
			blockedBy: 'play',
		});
		await shiritori.upsertSettings(db, G, { ...shiritori.DEFAULTS, enabled: false });
		expect((await loadGameStates(db, G, []))[1].blockedBy).toBeNull();
	});

	it('shows everything off with no database, and a planned game as off', async () => {
		const planned = { ...GAMES[0], id: 'soon', status: 'planned' as const, enable: undefined };
		expect(await loadGameStates(null, G, [], [...GAMES, planned])).toEqual([
			{ id: 'agent', enabled: false, blockedBy: null },
			{ id: 'shiritori', enabled: false, blockedBy: null },
			{ id: 'soon', enabled: false, blockedBy: null },
		]);
	});
});

describe('setGameEnabled', () => {
	it('flips Shiritori in its own settings and keeps the rest', async () => {
		await shiritori.upsertSettings(db, G, { ...shiritori.DEFAULTS, turnSeconds: 25 });
		expect(await setGameEnabled(db, G, findGame('shiritori')!, true)).toEqual({
			ok: true,
			sync: false,
		});
		expect(await shiritori.getSettings(db, G)).toMatchObject({
			enabled: true,
			turnSeconds: 25,
		});
	});

	it('flips the agent game through the /play override and asks for a sync', async () => {
		expect(await setGameEnabled(db, G, findGame('agent')!, false)).toEqual({
			ok: true,
			sync: true,
		});
		expect(commands.set).toHaveBeenCalledWith(db, G, 'cmd-play', { enabled: false });
	});

	it('fails when the command is missing or the override is refused', async () => {
		commands.list = [];
		expect(await setGameEnabled(db, G, findGame('agent')!, true)).toEqual({
			ok: false,
			status: 404,
			message: '/play is missing.',
		});
		commands.list = [{ id: 'cmd-play', name: 'play', enabled: true }];
		commands.set = vi.fn(async () => ({ success: false, error: 'nope' }));
		expect(await setGameEnabled(db, G, findGame('agent')!, true)).toEqual({
			ok: false,
			status: 400,
			message: 'nope',
		});
	});

	it('refuses a planned game', async () => {
		const planned = { ...GAMES[0], name: 'Later', status: 'planned' as const };
		expect(await setGameEnabled(db, G, planned, true)).toMatchObject({
			ok: false,
			status: 400,
		});
	});
});

const event = (fd: FormData, withDb = true) => ({
	request: { formData: async () => fd },
	cookies: { get: (n: string) => (n === 'discord_user_id' ? 'u1' : 'token') },
	platform: { env: withDb ? { DB: db } : {} },
	params: { serverId: G },
});
const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.set(k, v);
	return f;
};

describe('the toggleGame action', () => {
	it('turns Shiritori on without touching Discord commands', async () => {
		const out = await (actions as any).toggleGame(
			event(fd({ game: 'shiritori', enabled: 'on' }))
		);
		expect(out).toEqual({ success: true, message: 'Shiritori is on.' });
		expect((await shiritori.getSettings(db, G)).enabled).toBe(true);
		expect(sync).not.toHaveBeenCalled();
	});

	it('turns Hidden Agent off and syncs the command list', async () => {
		const out = await (actions as any).toggleGame(event(fd({ game: 'agent' })));
		expect(out).toEqual({ success: true, message: 'Hidden Agent is off.' });
		expect(sync).toHaveBeenCalledOnce();
	});

	it('refuses an unknown game, a missing command, no database, and a non-admin', async () => {
		expect((await (actions as any).toggleGame(event(fd({ game: 'x' })))).status).toBe(400);
		commands.list = [];
		expect((await (actions as any).toggleGame(event(fd({ game: 'agent' })))).status).toBe(404);
		expect(
			(await (actions as any).toggleGame(event(fd({ game: 'agent' }), false))).status
		).toBe(500);
		superadmin = false;
		const noCookie = { ...event(fd({ game: 'agent' })), cookies: { get: () => undefined } };
		expect((await (actions as any).toggleGame(noCookie)).status).toBe(401);
	});
});

describe('saveShiritori after the switch moved to the card', () => {
	const settings = { turnSeconds: '20', deadLetters: 'xz', allowWords: '', blockWords: '' };

	it('keeps the stored on/off when the form does not send it', async () => {
		await shiritori.upsertSettings(db, G, { ...shiritori.DEFAULTS, enabled: true });
		await (actions as any).saveShiritori(event(fd(settings)));
		expect(await shiritori.getSettings(db, G)).toMatchObject({
			enabled: true,
			turnSeconds: 20,
		});
	});

	it('still obeys a form that sends it', async () => {
		await (actions as any).saveShiritori(event(fd({ ...settings, enabled: 'on' })));
		expect((await shiritori.getSettings(db, G)).enabled).toBe(true);
	});
});
