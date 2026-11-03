import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: vi.fn(async () => ({ name: 'play' })),
}));
const sync = vi.fn();
vi.mock('$lib/discord/commands.js', () => ({ syncGuildCommands: (...a: any[]) => sync(...a) }));
vi.mock('$lib/discord/guilds.js', () => ({
	hasFullAdminPermission: () => true,
	verifyGuildAdmin: async () => ({ authorized: true, guild: {} }),
}));
vi.mock('$lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: () => false }));

import {
	NAME_MAX,
	cleanIcon,
	cleanName,
	cleanTagline,
	defaultDisplays,
	resolveAll,
	resolveDisplay,
} from '../lib/games/display.js';
import { GAMES } from '../lib/games/registry.js';
import {
	applyDisplaysToCommands,
	getGameDisplay,
	getGameDisplays,
	saveGameDisplay,
} from '../lib/server/game-display.js';
import { lobbyMessage, type Round } from '../lib/server/game.js';
import { roundMessage, type Round as SRound } from '../lib/server/shiritori-game.js';
import { modulesForGuild } from '../lib/server/activity.js';

const { actions } = await import('../routes/admin/[serverId]/activity/+page.server.js');

const migration = (file: string) =>
	readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
const NAMES = migration('0082_game_display_names.sql');
const SCHEMA =
	migration('0076_game.sql').split('-- /game as a built-in command family')[0] +
	migration('0081_shiritori.sql').split('-- `/play shiritori` joins')[0] +
	NAMES;

const G = '100000000000000001';
const G2 = '100000000000000002';
const ok = (value: string | null) => ({ ok: true, value });

describe('cleaning a name', () => {
	it('trims and collapses whitespace', () => {
		expect(cleanName('   Word   Chain  ')).toEqual(ok('Word Chain'));
	});

	it('empty or whitespace means the default', () => {
		expect(cleanName('')).toEqual(ok(null));
		expect(cleanName('   ')).toEqual(ok(null));
		expect(cleanName(undefined)).toEqual(ok(null));
		expect(cleanName(42)).toEqual(ok(null));
	});

	it('takes 40 characters and refuses 41', () => {
		expect(cleanName('x'.repeat(NAME_MAX))).toEqual(ok('x'.repeat(40)));
		expect(cleanName('x'.repeat(41))).toMatchObject({ ok: false });
	});

	it('counts an emoji as one character', () => {
		expect(cleanName('🔥'.repeat(40))).toMatchObject({ ok: true });
	});

	it('strips mention and markdown characters', () => {
		expect(cleanName('@everyone')).toEqual(ok('everyone'));
		expect(cleanName('<@123456789012345678>')).toEqual(ok('123456789012345678'));
		expect(cleanName('**Bold** _it_ ~~s~~ `c` ||sp|| > q # h')).toEqual(
			ok('Bold it s c sp q h')
		);
		expect(cleanName('[x]')).toEqual(ok('x'));
		expect(cleanName('a\\b')).toEqual(ok('ab'));
	});

	it('keeps ordinary punctuation', () => {
		expect(cleanName("Who's the Fed? (v2) - Classic: 3!")).toEqual(
			ok("Who's the Fed? (v2) - Classic: 3!")
		);
	});

	it('strips control and bidi characters, and newlines', () => {
		expect(cleanName('Word\nChain\t\u0007')).toEqual(ok('Word Chain'));
		expect(cleanName('a‮b​c')).toEqual(ok('a b c'));
		expect(cleanName('a b')).toEqual(ok('a b'));
	});

	it('refuses links', () => {
		for (const bad of [
			'https://x.y',
			'http:evil',
			'see www.evil',
			'discord.gg/abc',
			'discordapp.com/x',
			'evil.com',
			'go.gg',
		]) {
			expect(cleanName(bad), bad).toEqual({
				ok: false,
				error: 'Name cannot contain a link.',
			});
		}
	});

	it('a name that is only markup is empty, so the default', () => {
		expect(cleanName('***')).toEqual(ok(null));
	});
});

describe('cleaning a tagline', () => {
	it('takes 120 characters and labels its errors', () => {
		expect(cleanTagline('y'.repeat(120))).toMatchObject({ ok: true });
		expect(cleanTagline('y'.repeat(121))).toEqual({
			ok: false,
			error: 'Description must be 120 characters or fewer.',
		});
		expect(cleanTagline('www.x')).toEqual({
			ok: false,
			error: 'Description cannot contain a link.',
		});
	});
});

describe('cleaning an icon', () => {
	it.each(['🎲', '🕵️', '👩‍🚀', '🇺🇸', '3️⃣', '❤️', '🏳️‍🌈'])('takes one emoji: %s', (e) => {
		expect(cleanIcon(e)).toEqual(ok(e));
	});

	it('trims, and empty is the default', () => {
		expect(cleanIcon('  🎲 ')).toEqual(ok('🎲'));
		expect(cleanIcon('')).toEqual(ok(null));
		expect(cleanIcon(null)).toEqual(ok(null));
	});

	it.each(['🎲🎲', 'a', 'ab', '@', '<:x:1>', '1', '🎲a'])('refuses %s', (e) => {
		expect(cleanIcon(e)).toEqual({ ok: false, error: 'Icon must be a single emoji.' });
	});
});

describe('resolving', () => {
	it('falls back to the registry for every field', () => {
		const d = resolveDisplay('agent', null)!;
		expect(d).toEqual({
			id: 'agent',
			name: 'Hidden Agent',
			icon: '🕵️',
			tagline: GAMES[0].tagline,
			custom: { name: false, icon: false, tagline: false },
		});
	});

	it('uses what the server set, field by field', () => {
		const d = resolveDisplay('shiritori', {
			game_id: 'shiritori',
			name: 'Word Chain',
			icon: null,
		})!;
		expect(d).toMatchObject({
			name: 'Word Chain',
			icon: '🔤',
			custom: { name: true, icon: false, tagline: false },
		});
	});

	it('cleans a stored row again, and drops a value that fails', () => {
		const d = resolveDisplay('agent', {
			name: '**Imp**',
			icon: 'not an emoji',
			tagline: 'x'.repeat(200),
		})!;
		expect(d).toMatchObject({ name: 'Imp', icon: '🕵️', tagline: GAMES[0].tagline });
		expect(d.custom).toEqual({ name: true, icon: false, tagline: false });
	});

	it('an unknown game is null', () => {
		expect(resolveDisplay('chess', null)).toBeNull();
	});

	it('resolveAll covers every game, and defaultDisplays is all defaults', () => {
		const all = resolveAll([{ game_id: 'agent', name: 'Imp' }]);
		expect(Object.keys(all)).toEqual(GAMES.map((g) => g.id));
		expect(all.agent.name).toBe('Imp');
		expect(all.shiritori.name).toBe('Shiritori');
		expect(Object.values(defaultDisplays()).every((d) => !d.custom.name)).toBe(true);
	});
});

describe('storage', () => {
	it('saves, reads back per server, and resets', async () => {
		const db: any = createSqliteD1(NAMES);
		const saved = await saveGameDisplay(db, G, 'agent', {
			name: ' Impostor ',
			icon: '🔪',
			tagline: 'Find the impostor.',
		});
		expect(saved).toMatchObject({ ok: true, display: { name: 'Impostor', icon: '🔪' } });
		expect(await getGameDisplay(db, G, 'agent')).toMatchObject({
			name: 'Impostor',
			icon: '🔪',
			tagline: 'Find the impostor.',
		});
		// Another server is untouched.
		expect((await getGameDisplay(db, G2, 'agent')).name).toBe('Hidden Agent');

		// Saving again updates the row in place.
		await saveGameDisplay(db, G, 'agent', { name: 'Fed Hunt' });
		expect(await getGameDisplay(db, G, 'agent')).toMatchObject({
			name: 'Fed Hunt',
			icon: '🕵️',
			custom: { name: true, icon: false, tagline: false },
		});

		await saveGameDisplay(db, G, 'agent', {});
		const rows = db.prepare('SELECT * FROM game_display_names').all();
		expect((await rows).results).toEqual([]);
		expect((await getGameDisplay(db, G, 'agent')).custom.name).toBe(false);
	});

	it('typing the default back in stores nothing', async () => {
		const db: any = createSqliteD1(NAMES);
		await saveGameDisplay(db, G, 'shiritori', { name: 'Shiritori', icon: '🔤' });
		expect((await db.prepare('SELECT * FROM game_display_names').all()).results).toEqual([]);
	});

	it('refuses a bad value and stores nothing', async () => {
		const db: any = createSqliteD1(NAMES);
		expect(await saveGameDisplay(db, G, 'agent', { name: 'evil.com' })).toEqual({
			ok: false,
			error: 'Name cannot contain a link.',
		});
		expect(await saveGameDisplay(db, G, 'agent', { icon: 'ab' })).toMatchObject({ ok: false });
		expect(await saveGameDisplay(db, G, 'agent', { tagline: 'z'.repeat(121) })).toMatchObject({
			ok: false,
		});
		expect(await saveGameDisplay(db, G, 'chess', { name: 'Chess' })).toEqual({
			ok: false,
			error: 'Unknown game.',
		});
		expect((await db.prepare('SELECT * FROM game_display_names').all()).results).toEqual([]);
	});

	it('a missing table, or no database, reads as the defaults', async () => {
		const db: any = createSqliteD1('CREATE TABLE unrelated (x INTEGER);');
		expect((await getGameDisplays(db, G)).agent.name).toBe('Hidden Agent');
		expect((await getGameDisplays(null, G)).shiritori.name).toBe('Shiritori');
		expect((await getGameDisplay(null, G, 'nope' as string)) ?? null).toBeNull();
	});
});

describe('command descriptions', () => {
	const play = {
		name: 'play',
		description: 'A hidden-agent round for everyone in your voice channel',
		options: [
			{
				name: 'start',
				description: 'Open a lobby for the voice channel you are in',
				type: 1,
			},
			{ name: 'stop', description: 'End the round here', type: 1 },
			{ name: 'shiritori', description: 'Open a word-chain round in this channel', type: 1 },
		],
	};
	const other = { name: 'timebox', description: 'Focus', options: [] };

	it('leaves everything alone when nothing is renamed', () => {
		const cmds = [play, other];
		expect(applyDisplaysToCommands(cmds, defaultDisplays())).toBe(cmds);
	});

	it('names the game in /play and its subcommands, never renaming a command', () => {
		const displays = resolveAll([
			{ game_id: 'agent', name: 'Impostor' },
			{ game_id: 'shiritori', name: 'Word Chain' },
		]);
		const [p, o] = applyDisplaysToCommands([play, other], displays);
		expect(p.name).toBe('play');
		expect(p.description).toBe(play.description); // the top level covers every game
		expect(p.options.map((x: any) => [x.name, x.description])).toEqual([
			['start', 'Start Impostor in your voice channel'],
			['stop', 'End the round here'],
			['shiritori', 'Start Word Chain in this channel'],
		]);
		expect(o).toBe(other);
		expect(play.description).toBe('A hidden-agent round for everyone in your voice channel');
	});

	it('only Shiritori renamed keeps the /play description', () => {
		const [p] = applyDisplaysToCommands(
			[play],
			resolveAll([{ game_id: 'shiritori', name: 'WC' }])
		);
		expect(p.description).toBe(play.description);
		expect(p.options[0].description).toBe(play.options[0].description);
		expect(p.options[2].description).toBe('Start WC in this channel');
	});

	it('reads options stored as JSON text, and survives bad JSON', () => {
		const displays = resolveAll([{ game_id: 'agent', name: 'Imp' }]);
		const [p] = applyDisplaysToCommands(
			[{ ...play, options: JSON.stringify(play.options) } as Record<string, any>],
			displays
		);
		expect(p.options[0].description).toBe('Start Imp in your voice channel');
		const [q] = applyDisplaysToCommands([{ ...play, options: '{nope' }], displays);
		expect(q.options).toBe('{nope');
		expect(q.description).toBe(play.description);
	});

	it('names the game in /game the same way as its twin /play', () => {
		const displays = resolveAll([{ game_id: 'agent', name: 'Imp' }]);
		const [g] = applyDisplaysToCommands([{ ...play, name: 'game' }], displays);
		expect(g.name).toBe('game');
		expect(g.options[0].description).toBe('Start Imp in your voice channel');
	});

	it('stays within Discord’s 100-character description limit', () => {
		const displays = resolveAll([{ game_id: 'agent', name: 'x'.repeat(40) }]);
		const long = { ...play, options: [{ name: 'start', description: '', type: 1 }] };
		const [p] = applyDisplaysToCommands([long], displays);
		expect(p.description.length).toBeLessThanOrEqual(100);
		expect(p.options[0].description.length).toBeLessThanOrEqual(100);
	});
});

describe('posts use the server’s name', () => {
	const agentRound = (over: Partial<Round> = {}) =>
		({
			id: 1,
			guild_id: G,
			voice_channel_id: '300000000000000001',
			status: 'lobby',
			agent_name: 'Agent',
			min_players: 4,
			ends_at: '2026-10-15T12:05:00.000Z',
			...over,
		}) as Round;
	const chainRound = (over: Partial<SRound> = {}) =>
		({
			id: 1,
			guild_id: G,
			channel_id: '200000000000000002',
			status: 'lobby',
			voice: 0,
			hard_mode: 0,
			dead_letter: 'x',
			turn_seconds: 15,
			lap: 0,
			result: 'cancelled',
			...over,
		}) as unknown as SRound;

	it('Hidden Agent cards keep "Hidden <role>" until the server renames it', async () => {
		const db: any = createSqliteD1(SCHEMA);
		const msg = await lobbyMessage(db, agentRound({ agent_name: 'Impostor' }));
		expect(msg.content).toMatch(/^\*\*Hidden Impostor — lobby\*\*/);
	});

	it('Hidden Agent cards carry the custom name and icon', async () => {
		const db: any = createSqliteD1(SCHEMA);
		await saveGameDisplay(db, G, 'agent', { name: 'Fed Hunt', icon: '🔪' });
		expect((await lobbyMessage(db, agentRound())).content).toMatch(
			/^🔪 \*\*Fed Hunt — lobby\*\*/
		);
		expect((await lobbyMessage(db, agentRound({ status: 'running' }))).content).toMatch(
			/^🔪 \*\*Fed Hunt — round running\*\*/
		);
		const over = await lobbyMessage(db, agentRound({ status: 'ended' }));
		expect(over.content).toMatch(/^🔪 \*\*Fed Hunt — over\*\*/);
		expect(over.allowed_mentions).toEqual({ parse: [] });
		// Another server sees the default.
		expect((await lobbyMessage(db, agentRound({ guild_id: G2 }))).content).toMatch(
			/^\*\*Hidden Agent — lobby/
		);
	});

	it('an icon alone keeps the default heading', async () => {
		const db: any = createSqliteD1(SCHEMA);
		await saveGameDisplay(db, G, 'agent', { icon: '🎭' });
		expect((await lobbyMessage(db, agentRound())).content).toMatch(
			/^🎭 \*\*Hidden Agent — lobby/
		);
	});

	it('Shiritori cards carry the custom name and icon', async () => {
		const db: any = createSqliteD1(SCHEMA);
		expect((await roundMessage(db, chainRound())).content).toMatch(/^🔗 \*\*Shiritori — lobby/);
		await saveGameDisplay(db, G, 'shiritori', { name: 'Word Chain', icon: '⛓️' });
		expect((await roundMessage(db, chainRound())).content).toMatch(
			/^⛓️ \*\*Word Chain — lobby/
		);
		expect((await roundMessage(db, chainRound({ status: 'running' }))).content).toMatch(
			/^⛓️ \*\*Word Chain\*\*/
		);
		expect((await roundMessage(db, chainRound({ status: 'ended' }))).content).toMatch(
			/^⛓️ \*\*Word Chain — over/
		);
	});

	it('a renamed Shiritori with no icon keeps the 🔗/🎙️ marks', async () => {
		const db: any = createSqliteD1(SCHEMA);
		await saveGameDisplay(db, G, 'shiritori', { name: 'Word Chain' });
		expect((await roundMessage(db, chainRound({ status: 'running' }))).content).toMatch(
			/^🔗 \*\*Word Chain\*\*/
		);
	});
});

describe('the Activity tab label', () => {
	it('is absent by default and the server’s name once renamed', async () => {
		const db: any = createSqliteD1(NAMES);
		const before = await modulesForGuild(db, G);
		expect(before.find((m) => m.id === 'game')?.label).toBeUndefined();
		await saveGameDisplay(db, G, 'agent', { name: 'Impostor' });
		const after = await modulesForGuild(db, G);
		expect(after.find((m) => m.id === 'game')?.label).toBe('Impostor');
		expect(after.find((m) => m.id === 'timebox')?.label).toBeUndefined();
	});
});

describe('dashboard: saving a game’s name', () => {
	const run = (db: any, fields: Record<string, string>, user: string | null = 'someone') => {
		const fd = new FormData();
		for (const [k, v] of Object.entries(fields)) fd.set(k, v);
		return (actions as any).saveGameName({
			request: { formData: async () => fd },
			cookies: { get: () => user },
			platform: { env: { DB: db } },
			params: { serverId: G },
		});
	};

	it('saves, syncs the commands, and Reset clears it', async () => {
		const db: any = createSqliteD1(NAMES);
		sync.mockClear();
		const out = await run(db, {
			game: 'shiritori',
			name: 'Word Chain',
			icon: '⛓️',
			tagline: '',
		});
		expect(out).toEqual({
			success: true,
			game: 'shiritori',
			message: 'Saved. Members now see Word Chain.',
		});
		expect(sync).toHaveBeenCalledTimes(1);
		expect((await getGameDisplay(db, G, 'shiritori')).name).toBe('Word Chain');

		const reset = await run(db, { game: 'shiritori', name: 'ignored', reset: '1' });
		expect(reset.message).toBe('Shiritori is back to its default name.');
		expect((await getGameDisplay(db, G, 'shiritori')).custom.name).toBe(false);
	});

	it('hands a bad name back to its own card', async () => {
		const db: any = createSqliteD1(NAMES);
		const out = await run(db, { game: 'agent', name: 'join discord.gg/x' });
		expect(out.status).toBe(400);
		expect(out.data).toEqual({
			success: false,
			game: 'agent',
			message: 'Name cannot contain a link.',
		});
	});

	it('refuses an unknown game, no database, and nobody signed in', async () => {
		const db: any = createSqliteD1(NAMES);
		expect((await run(db, { game: 'chess', name: 'x' })).status).toBe(400);
		expect((await run(null, { game: 'agent', name: 'x' })).status).toBe(500);
		expect((await run(db, { game: 'agent', name: 'x' }, null)).status).toBe(401);
	});
});
