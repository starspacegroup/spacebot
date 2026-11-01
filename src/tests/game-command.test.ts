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
