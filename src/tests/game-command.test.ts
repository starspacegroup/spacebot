import { describe, expect, it } from 'vitest';
import {
	GAME_ALIAS_DESCRIPTION,
	gameSubcommand,
	isBuiltInGameInteraction,
	makeGameAlias,
	resolveGameAlias,
	unifyGameCommands,
} from '../lib/discord/game-command.js';
import { buildHelpEntries } from '../lib/discord/help.js';

const sub = (name: string) => ({ name, description: name, type: 1 });
const builtInGame = {
	name: 'game',
	description: 'Games for the server',
	type: 1,
	default_member_permissions: null,
	options: ['start', 'stop', 'status', 'shiritori'].map(sub),
};
// The *Space Game integration's manifest (starspacegroup/game, static/spacebot-integration.json).
const integrationGame = {
	name: 'game',
	description: 'Game commands for *Space',
	type: 1,
	options: [
		{ ...sub('stats'), options: [{ name: 'player', description: 'p', type: 6 }] },
		sub('leaderboard'),
		sub('play'),
	],
};
const other = { name: 'ping', description: 'p', type: 1 };

const byName = (list: any[], name: string) => list.filter((c) => c.name === name);

describe('unifyGameCommands', () => {
	it('merges the integration /game into the built-in one, and adds /play', () => {
		const { builtIn, integration } = unifyGameCommands(
			[other, builtInGame],
			[integrationGame, { name: 'other-int', type: 1 }]
		);
		const [game] = byName(builtIn, 'game');
		expect(game.options.map((o: any) => o.name)).toEqual([
			'start',
			'stop',
			'status',
			'shiritori',
			'stats',
			'leaderboard',
			'play',
		]);
		expect(game.options.find((o: any) => o.name === 'stats').options).toHaveLength(1);
		expect(byName(integration, 'game')).toEqual([]);
		expect(integration.map((c) => c.name)).toEqual(['other-int']);
		expect(builtInGame.options).toHaveLength(4); // inputs untouched
	});

	it('makes /play identical to /game but for name and description', () => {
		for (const ints of [[], [integrationGame]]) {
			const { builtIn } = unifyGameCommands([builtInGame], ints);
			const [game] = byName(builtIn, 'game');
			const [play] = byName(builtIn, 'play');
			expect(play.description).toBe(GAME_ALIAS_DESCRIPTION);
			const { name: _a, description: _b, ...gameRest } = game;
			const { name: _c, description: _d, ...playRest } = play;
			expect(playRest).toEqual(gameRest);
		}
	});

	it('keeps a built-in subcommand on a name clash', () => {
		const clash = { ...integrationGame, options: [sub('start'), sub('stats')] };
		const { builtIn } = unifyGameCommands([builtInGame], [clash]);
		expect(byName(builtIn, 'game')[0].options.map((o: any) => o.name)).toEqual([
			'start',
			'stop',
			'status',
			'shiritori',
			'stats',
		]);
	});

	it('leaves the integration /game alone where the built-in is off, with /play beside it', () => {
		const { builtIn, integration } = unifyGameCommands([other], [integrationGame]);
		expect(builtIn).toEqual([other]);
		expect(byName(integration, 'game')).toEqual([integrationGame]);
		expect(byName(integration, 'play')[0].options).toEqual(integrationGame.options);
	});

	it('adds nothing when neither has /game, and drops a stale /play row', () => {
		expect(unifyGameCommands([other], [])).toEqual({ builtIn: [other], integration: [] });
		const stale = { name: 'play', type: 1 };
		expect(unifyGameCommands([other, stale], []).builtIn).toEqual([other]);
		const noOpts = { name: 'game', description: 'g', type: 1 };
		const merged = unifyGameCommands([noOpts], [{ name: 'game', type: 1 }]);
		expect(byName(merged.builtIn, 'game')[0].options).toEqual([]);
	});

	it('makeGameAlias keeps the options by reference-equal value', () => {
		expect(makeGameAlias(builtInGame).options).toBe(builtInGame.options);
	});
});

describe('routing helpers', () => {
	it('reads /play as /game and leaves others', () => {
		expect(resolveGameAlias({ name: 'play', options: [sub('start')] })).toEqual({
			name: 'game',
			options: [sub('start')],
		});
		const ping = { name: 'ping' };
		expect(resolveGameAlias(ping)).toBe(ping);
		expect(resolveGameAlias(null)).toBeNull();
	});

	it('tells built-in game subcommands from the integration ones', () => {
		expect(isBuiltInGameInteraction({ options: [sub('shiritori')] })).toBe(true);
		expect(isBuiltInGameInteraction({ options: [sub('stats')] })).toBe(false);
		expect(isBuiltInGameInteraction({ options: [] })).toBe(false);
		expect(gameSubcommand({ options: [{ name: 'g', type: 2 }] })).toBe('g');
		expect(gameSubcommand({})).toBeNull();
	});
});

describe('help for /game', () => {
	it('shows one /game with both sets of subcommands and names /play', () => {
		const entries = buildHelpEntries(
			{ builtIn: [builtInGame], integration: [integrationGame] },
			{ permissions: '8' }
		);
		const games = entries.filter((e) => e.name === 'game');
		expect(games).toHaveLength(1);
		expect(games[0].description).toContain('`/play` works too');
		expect(games[0].subcommands).toEqual(
			expect.arrayContaining(['start', 'shiritori', 'stats', 'leaderboard', 'play'])
		);
		expect(new Set(games[0].subcommands).size).toBe(games[0].subcommands.length);
	});
});

describe('migration 0083', () => {
	it('renames the built-in /play row to /game, keeping its id, once', async () => {
		const { readFileSync } = await import('node:fs');
		const { createSqliteD1 } = await import('./helpers/sqlite-d1.js');
		const sql = readFileSync(
			new URL('../../migrations/0083_game_command_unified.sql', import.meta.url),
			'utf8'
		);
		const db: any = createSqliteD1();
		db.exec(`CREATE TABLE commands (id INTEGER PRIMARY KEY, guild_id TEXT, name TEXT,
			description TEXT, options TEXT, is_built_in INTEGER);
			INSERT INTO commands VALUES (7, '__built_in__', 'play', 'old', '[]', 1);`);
		db.exec(sql);
		db.exec(sql);
		const row = await db.prepare('SELECT * FROM commands WHERE id = 7').first();
		expect(row.name).toBe('game');
		expect(JSON.parse(row.options).map((o: any) => o.name)).toEqual([
			'start',
			'stop',
			'status',
			'shiritori',
		]);
	});
});

describe('migration 0085 (repair for a skipped 0083)', () => {
	async function setup(rows: string) {
		const { readFileSync } = await import('node:fs');
		const { createSqliteD1 } = await import('./helpers/sqlite-d1.js');
		const sql = readFileSync(
			new URL('../../migrations/0085_game_command_repair.sql', import.meta.url),
			'utf8'
		);
		const db: any = createSqliteD1();
		db.exec(`CREATE TABLE commands (id INTEGER PRIMARY KEY, guild_id TEXT, name TEXT,
			description TEXT, options TEXT, is_built_in INTEGER);
			CREATE TABLE built_in_command_overrides (id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id TEXT NOT NULL, command_id INTEGER NOT NULL, enabled INTEGER,
			default_member_permissions TEXT, access_rules TEXT, UNIQUE(guild_id, command_id));
			${rows}`);
		return { db, sql };
	}

	it('gives /game Shiritori and carries the stale /play row’s overrides over', async () => {
		// Production on 2026-11-04: an old /game without shiritori, a stale /play with it.
		const { db, sql } = await setup(`
			INSERT INTO commands VALUES (447, '__built_in__', 'game', 'old',
				'[{"name":"start","type":1}]', 1);
			INSERT INTO commands VALUES (411, '__built_in__', 'play', 'old', '[]', 1);
			INSERT INTO built_in_command_overrides (guild_id, command_id, enabled) VALUES ('a', 411, 1);
			INSERT INTO built_in_command_overrides (guild_id, command_id, enabled) VALUES ('b', 411, 1);
			INSERT INTO built_in_command_overrides (guild_id, command_id, enabled) VALUES ('b', 447, 0);`);
		db.exec(sql);
		db.exec(sql);
		const rows = (await db.prepare('SELECT * FROM commands').all()).results;
		expect(rows.map((r: any) => r.name)).toEqual(['game']);
		expect(JSON.parse(rows[0].options).map((o: any) => o.name)).toEqual([
			'start',
			'stop',
			'status',
			'shiritori',
		]);
		const overrides = (
			await db
				.prepare(
					'SELECT guild_id, command_id, enabled FROM built_in_command_overrides ORDER BY guild_id'
				)
				.all()
		).results;
		// a: moved onto /game. b: its own /game override wins over the stale one.
		expect(overrides).toEqual([
			{ guild_id: 'a', command_id: 447, enabled: 1 },
			{ guild_id: 'b', command_id: 447, enabled: 0 },
		]);
	});

	it('changes nothing where 0083 already worked', async () => {
		const { db, sql } = await setup(`
			INSERT INTO commands VALUES (7, '__built_in__', 'game', 'x',
				'[{"name":"shiritori","type":1}]', 1);
			INSERT INTO built_in_command_overrides (guild_id, command_id, enabled) VALUES ('a', 7, 1);`);
		db.exec(sql);
		const row = await db.prepare('SELECT * FROM commands').first();
		expect(row.description).toBe('x');
		expect(
			(await db.prepare('SELECT COUNT(*) c FROM built_in_command_overrides').first()).c
		).toBe(1);
	});
});

describe('migration 0086 (channel option on /game shiritori)', () => {
	const OPTIONS =
		'[{"name":"start","type":1},{"name":"shiritori","description":"Open a Shiritori word-chain round in this channel","type":1}]';

	async function run(options: string, times = 1) {
		const { readFileSync } = await import('node:fs');
		const { createSqliteD1 } = await import('./helpers/sqlite-d1.js');
		const sql = readFileSync(
			new URL('../../migrations/0086_shiritori_channel_option.sql', import.meta.url),
			'utf8'
		);
		const db: any = createSqliteD1();
		db.exec(`CREATE TABLE commands (id INTEGER PRIMARY KEY, guild_id TEXT, name TEXT,
			description TEXT, options TEXT, is_built_in INTEGER);`);
		await db
			.prepare(`INSERT INTO commands VALUES (1, '__built_in__', 'game', 'x', ?, 1)`)
			.bind(options)
			.run();
		for (let i = 0; i < times; i++) db.exec(sql);
		const row: any = await db.prepare('SELECT options FROM commands').first();
		return JSON.parse(row.options);
	}

	it('adds an optional text-channel option to shiritori, once', async () => {
		const options = await run(OPTIONS, 2);
		const shiritori = options.find((o: any) => o.name === 'shiritori');
		expect(shiritori.options).toHaveLength(1);
		expect(shiritori.options[0]).toMatchObject({
			name: 'channel',
			type: 7,
			channel_types: [0, 5],
			required: false,
		});
		expect(options.find((o: any) => o.name === 'start').options).toBeUndefined();
	});

	it('leaves a /game without shiritori alone', async () => {
		const options = await run('[{"name":"start","type":1}]');
		expect(options).toEqual([{ name: 'start', type: 1 }]);
	});
});

describe('migration 0087 (off option on /game shiritori)', () => {
	async function run(times: number) {
		const { readFileSync } = await import('node:fs');
		const { createSqliteD1 } = await import('./helpers/sqlite-d1.js');
		const file = (n: string) =>
			readFileSync(new URL(`../../migrations/${n}`, import.meta.url), 'utf8');
		const db: any = createSqliteD1();
		db.exec(`CREATE TABLE commands (id INTEGER PRIMARY KEY, guild_id TEXT, name TEXT,
			description TEXT, options TEXT, is_built_in INTEGER);`);
		await db
			.prepare(`INSERT INTO commands VALUES (1, '__built_in__', 'game', 'x', ?, 1)`)
			.bind(
				'[{"name":"shiritori","description":"Open a Shiritori word-chain round in this channel","type":1}]'
			)
			.run();
		db.exec(file('0086_shiritori_channel_option.sql'));
		for (let i = 0; i < times; i++) db.exec(file('0087_shiritori_off_option.sql'));
		const row: any = await db.prepare('SELECT options FROM commands').first();
		return JSON.parse(row.options);
	}

	it('adds a boolean off option after channel, once', async () => {
		const [shiritori] = await run(2);
		expect(shiritori.options.map((o: any) => [o.name, o.type])).toEqual([
			['channel', 7],
			['off', 5],
		]);
	});
});

describe('migration 0088 (rules option on /game shiritori)', () => {
	it('adds a boolean rules option after off, once', async () => {
		const { readFileSync } = await import('node:fs');
		const { createSqliteD1 } = await import('./helpers/sqlite-d1.js');
		const file = (n: string) =>
			readFileSync(new URL(`../../migrations/${n}`, import.meta.url), 'utf8');
		const db: any = createSqliteD1();
		db.exec(`CREATE TABLE commands (id INTEGER PRIMARY KEY, guild_id TEXT, name TEXT,
			description TEXT, options TEXT, is_built_in INTEGER);`);
		await db
			.prepare(`INSERT INTO commands VALUES (1, '__built_in__', 'game', 'x', ?, 1)`)
			.bind(
				'[{"name":"shiritori","description":"Open a Shiritori word-chain round in this channel","type":1}]'
			)
			.run();
		for (const n of ['0086_shiritori_channel_option.sql', '0087_shiritori_off_option.sql'])
			db.exec(file(n));
		for (let i = 0; i < 2; i++) db.exec(file('0088_shiritori_rules_option.sql'));
		const row: any = await db.prepare('SELECT options FROM commands').first();
		const [shiritori] = JSON.parse(row.options);
		expect(shiritori.options.map((o: any) => [o.name, o.type])).toEqual([
			['channel', 7],
			['off', 5],
			['rules', 5],
		]);
	});
});
