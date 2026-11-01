import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

let playEnabled = true;
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: vi.fn(async () => (playEnabled ? { name: 'play' } : null)),
}));

import {
	DEFAULTS,
	LOBBY_TTL_MS,
	START_GRACE_SECONDS,
	chainRecord,
	clockFor,
	eliminate,
	getHealth,
	getLeaderboard,
	getOpenChain,
	getPlayers,
	getRound,
	getSettings,
	guildDictionary,
	handleMessage,
	handleShiritoriCommand,
	handleShiritoriComponent,
	syncPresence,
	AWAY_GRACE_MS,
	isFail,
	joinRound,
	leaveRound,
	listActive,
	liveRoundIn,
	nextSeat,
	openRound,
	parseWordList,
	resetChain,
	roundStats,
	sentTime,
	shuffle,
	startRound,
	sweepShiritori,
	tickRounds,
	upsertSettings,
	wordToken,
	type Player,
	type Round,
} from '../lib/server/shiritori-game.js';
import { isWord } from '../lib/server/shiritori-dict.js';

const migration = (file: string) =>
	readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
const SCHEMA =
	migration('0041_live_voice_states.sql') +
	'ALTER TABLE live_voice_states ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;\n' +
	'CREATE TABLE guild_channels (guild_id TEXT, channel_id TEXT, name TEXT, type INTEGER);\n' +
	migration('0081_shiritori.sql').split('-- `/play shiritori` joins')[0];

const GUILD = '100000000000000001';
const CHAIN_CH = '200000000000000001';
const ROUND_CH = '200000000000000002';
const T0 = new Date('2026-10-31T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const NO_SHUFFLE = () => 0.99; // keeps the order the players joined in

function fakeDiscord() {
	const sent: { channelId: string; payload: any }[] = [];
	const edits: { channelId: string; messageId: string; payload: any }[] = [];
	const reactions: { messageId: string; emoji: string }[] = [];
	const deleted: string[] = [];
	return {
		sent,
		edits,
		reactions,
		deleted,
		channels: {
			deleteMessage: async (_c: string, messageId: string) => {
				deleted.push(messageId);
			},
			send: async (channelId: string, payload: any) => {
				sent.push({ channelId, payload });
				return { id: `bot-${sent.length}` };
			},
			editMessage: async (channelId: string, messageId: string, payload: any) => {
				edits.push({ channelId, messageId, payload });
			},
			react: async (_c: string, messageId: string, emoji: string) => {
				reactions.push({ messageId, emoji });
			},
		},
	};
}

let db: ReturnType<typeof createSqliteD1>;
let discord: ReturnType<typeof fakeDiscord>;
let n = 0;

const say = (channelId: string, userId: string, content: string, when = T0) => ({
	guildId: GUILD,
	channelId,
	messageId: `msg-${++n}`,
	userId,
	content,
	sentAt: when.toISOString(),
});

async function enable(over: Partial<typeof DEFAULTS> = {}) {
	await upsertSettings(db, GUILD, {
		...DEFAULTS,
		enabled: true,
		chainChannelId: CHAIN_CH,
		deadLetters: 'x',
		...over,
	});
}

/** Open a chain and pin its seed so the test knows the letters. */
async function chainFrom(seed: string) {
	await handleMessage(db, discord, say(CHAIN_CH, 'starter', 'kick'), T0, () => 0.3);
	await db
		.prepare(
			`UPDATE shiritori_chains SET seed_word = ?, last_word = ?, dead_letter = 'x' WHERE ended_at IS NULL`
		)
		.bind(seed, seed)
		.run();
	discord.sent.length = 0;
	discord.reactions.length = 0;
}

beforeEach(() => {
	playEnabled = true;
	db = createSqliteD1(SCHEMA);
	discord = fakeDiscord();
});

describe('helpers', () => {
	it('reads a typed word, and ignores talk', () => {
		expect(wordToken(' Apple ')).toBe('apple');
		expect(wordToken('two words')).toBeNull();
		expect(wordToken('apple!')).toBeNull();
		expect(wordToken('// apple')).toBeNull();
		expect(wordToken('')).toBeNull();
		expect(wordToken('https://x.io')).toBeNull();
	});

	it('parses a word list from lines, commas and spaces', () => {
		expect([...parseWordList('Holodeck, tribble\nwarp  no 9 ab')].sort()).toEqual([
			'holodeck',
			'tribble',
			'warp',
		]);
	});

	it('lets a server allow and block words', () => {
		const dict = guildDictionary({
			...DEFAULTS,
			allowWords: 'holodeck',
			blockWords: 'galaxy',
		});
		expect(dict.isWord('holodeck')).toBe(true);
		expect(dict.isBlocked('galaxy')).toBe(true);
		expect(dict.isBlocked('fucking')).toBe(true);
		const allowed = guildDictionary({ ...DEFAULTS, allowWords: 'fucking' });
		expect(allowed.isBlocked('fucking')).toBe(false);
	});

	it('drops the clock a second a lap, to a floor', () => {
		expect(clockFor(15, 0)).toBe(15);
		expect(clockFor(15, 4)).toBe(11);
		expect(clockFor(15, 99)).toBe(5);
	});

	it('finds the next live seat and says when it wrapped', () => {
		const p = (user_id: string, seat: number, state: 'in' | 'out' = 'in') =>
			({ user_id, seat, state }) as Player;
		const players = [p('a', 0), p('b', 1, 'out'), p('c', 2)];
		expect(nextSeat(players, 0)).toMatchObject({ player: { user_id: 'c' }, lapped: false });
		expect(nextSeat(players, 2)).toMatchObject({ player: { user_id: 'a' }, lapped: true });
		expect(nextSeat([p('a', 0, 'out')], 0)).toBeNull();
	});

	it('shuffles without losing anyone', () => {
		expect(shuffle([1, 2, 3, 4], NO_SHUFFLE)).toEqual([1, 2, 3, 4]);
		expect(shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
	});

	it('trusts a send time only if it is real and not in the future', () => {
		const now = at(10);
		expect(sentTime(at(5).toISOString(), now)).toEqual(at(5));
		expect(sentTime(undefined, now)).toEqual(now);
		expect(sentTime('not a date', now)).toEqual(now);
		expect(sentTime(at(60).toISOString(), now)).toEqual(now);
	});

	it('summarises a round', () => {
		expect(roundStats([])).toEqual({ longest: null, letter: null, letterCount: 0 });
		const st = roundStats([{ word: 'apple' }, { word: 'eagle' }, { word: 'elephant' }]);
		expect(st).toEqual({ longest: 'elephant', letter: 'e', letterCount: 2 });
	});
});

describe('settings', () => {
	it('is off by default and round-trips', async () => {
		expect(await getSettings(db, GUILD)).toEqual(DEFAULTS);
		await enable({ turnSeconds: 20, hardMode: true, allowWords: 'holodeck' });
		expect(await getSettings(db, GUILD)).toMatchObject({
			enabled: true,
			chainChannelId: CHAIN_CH,
			turnSeconds: 20,
			hardMode: true,
			allowWords: 'holodeck',
		});
	});
});

describe('Chain mode', () => {
	it('does nothing while Shiritori is off', async () => {
		const out = await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'apple'), T0);
		expect(out).toEqual({ action: 'ignore' });
		expect(await getOpenChain(db, GUILD, CHAIN_CH)).toBeNull();
	});

	it('opens a chain on the first word and says what the word is', async () => {
		await enable();
		const out = await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'apple'), T0);
		expect(out).toEqual({ action: 'started' });
		const chain = await getOpenChain(db, GUILD, CHAIN_CH);
		expect(chain?.length).toBe(0);
		expect(discord.sent[0].payload.content).toContain(chain!.seed_word);
		expect(discord.sent[0].payload.content).toContain('Dead letter');
	});

	it('ignores talk: several words, links, short words and // lines', async () => {
		await enable();
		await chainFrom('apple');
		for (const text of ['hello there', 'https://x.io', 'ok', '// eagle', 'eagle!']) {
			const out = await handleMessage(db, discord, say(CHAIN_CH, 'u1', text), T0);
			expect(out).toEqual({ action: 'ignore' });
		}
		expect((await getOpenChain(db, GUILD, CHAIN_CH))?.length).toBe(0);
		expect(discord.reactions).toEqual([]);
	});

	it('ignores bots and other channels', async () => {
		await enable();
		await chainFrom('apple');
		expect(
			await handleMessage(db, discord, { ...say(CHAIN_CH, 'bot', 'eagle'), isBot: true }, T0)
		).toEqual({ action: 'ignore' });
		expect(await handleMessage(db, discord, say('999', 'u1', 'eagle'), T0)).toEqual({
			action: 'ignore',
		});
	});

	it('accepts a word that follows, with a ✅, and counts it', async () => {
		await enable();
		await chainFrom('apple');
		const msg = say(CHAIN_CH, 'u1', 'Eagle');
		expect(await handleMessage(db, discord, msg, T0)).toEqual({ action: 'accepted' });
		expect(discord.reactions).toEqual([{ messageId: msg.messageId, emoji: '✅' }]);
		const chain = await getOpenChain(db, GUILD, CHAIN_CH);
		expect(chain).toMatchObject({ length: 1, last_word: 'eagle', last_user_id: 'u1' });
		const board = await getLeaderboard(db, GUILD);
		expect(board[0]).toMatchObject({ user_id: 'u1', words_added: 1, longest_word: 'eagle' });
	});

	it('refuses the same member twice in a row without breaking the chain', async () => {
		await enable();
		await chainFrom('apple');
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		const out = await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'elephant'), T0);
		expect(out).toEqual({ action: 'refused' });
		expect((await getOpenChain(db, GUILD, CHAIN_CH))?.length).toBe(1);
		expect(discord.reactions.at(-1)?.emoji).toBe('❌');
	});

	it('breaks on a word that starts with the wrong letter, and starts a new chain', async () => {
		await enable();
		await chainFrom('apple');
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		const old = await getOpenChain(db, GUILD, CHAIN_CH);
		const out = await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'banana'), T0);
		expect(out).toEqual({ action: 'broken', reason: 'bad_start' });
		expect(discord.reactions.at(-1)?.emoji).toBe('❌');
		const summary = discord.sent.at(-1)!.payload.content;
		expect(summary).toContain('<@u2> broke the chain');
		expect(summary).toContain('**1** word.');
		expect(summary).toContain('New chain');
		const fresh = await getOpenChain(db, GUILD, CHAIN_CH);
		expect(fresh?.id).not.toBe(old?.id);
		expect(fresh?.length).toBe(0);
		expect(
			(await getLeaderboard(db, GUILD)).find((r) => r.user_id === 'u2')?.chains_broken
		).toBe(1);
	});

	it('breaks on a word that is not in the dictionary, and a repeat; refuses a blocked word', async () => {
		await enable({ blockWords: 'elbow' });
		await chainFrom('apple');
		expect(await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'ezzzq'), T0)).toEqual({
			action: 'broken',
			reason: 'not_a_word',
		});

		await chainFrom('apple');
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'elephant'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'tiger'), T0);
		// 'tigers' is the same word as 'tiger', and 'r' no longer follows; use a legal start
		await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'rabbit'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'tigers'), T0).then((o) =>
			expect(o).toMatchObject({ action: 'broken' })
		);

		await chainFrom('apple');
		const open = await getOpenChain(db, GUILD, CHAIN_CH);
		expect(await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'elbow'), T0)).toEqual({
			action: 'refused',
		});
		expect((await getOpenChain(db, GUILD, CHAIN_CH))?.id).toBe(open?.id);
		expect(discord.reactions.at(-1)?.emoji).toBe('❌');
	});

	it('breaks on a repeat of an inflection', async () => {
		await enable();
		await chainFrom('apple');
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'elephant'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'tea'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'apple'), T0).then((o) =>
			expect(o).toEqual({ action: 'broken', reason: 'repeat' })
		);
	});

	it('ends the chain on the dead letter, and still counts the word', async () => {
		await enable();
		await chainFrom('apple');
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'elephant'), T0);
		const out = await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'tax'), T0);
		expect(out).toEqual({ action: 'ended', reason: 'dead_letter' });
		const summary = discord.sent.at(-1)!.payload.content;
		expect(summary).toContain('dead letter **x**');
		expect(summary).toContain('**3** words');
		expect(summary).toContain('🏆');
		expect(await chainRecord(db, GUILD)).toBe(3);
		const u1 = (await getLeaderboard(db, GUILD)).find((r) => r.user_id === 'u1');
		expect(u1).toMatchObject({ words_added: 2, chains_broken: 0 });
		expect((await getOpenChain(db, GUILD, CHAIN_CH))?.length).toBe(0);
	});

	it('uses the last two letters in hard mode', async () => {
		await enable({ hardMode: true });
		await handleMessage(db, discord, say(CHAIN_CH, 'starter', 'kick'), T0, () => 0.3);
		await db
			.prepare(
				`UPDATE shiritori_chains SET seed_word = 'apple', last_word = 'apple', dead_letter = 'x'`
			)
			.run();
		expect(await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0)).toEqual({
			action: 'broken',
			reason: 'bad_start',
		});
	});

	it('lets Crew reset the chain', async () => {
		await enable();
		await chainFrom('apple');
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		const before = await getOpenChain(db, GUILD, CHAIN_CH);
		expect(await resetChain(db, discord, GUILD, T0)).toBe(true);
		const after = await getOpenChain(db, GUILD, CHAIN_CH);
		expect(after?.id).not.toBe(before?.id);
		expect(discord.sent.at(-1)!.payload.content).toContain('reset by Crew');
		await upsertSettings(db, GUILD, { ...DEFAULTS, enabled: true });
		expect(await resetChain(db, discord, GUILD, T0)).toBe(false);
	});

	it('does not post twice when two breaks race', async () => {
		await enable();
		await chainFrom('apple');
		await Promise.all([
			handleMessage(db, discord, say(CHAIN_CH, 'u1', 'banana'), T0),
			handleMessage(db, discord, say(CHAIN_CH, 'u2', 'cherry'), T0),
		]);
		expect(
			discord.sent.filter((s) => s.payload.content.includes('broke the chain'))
		).toHaveLength(1);
	});
});

describe('Round mode', () => {
	const start = async (players = ['u1', 'u2'], settings: Partial<typeof DEFAULTS> = {}) => {
		await enable(settings);
		const round = await openRound(
			db,
			discord,
			{ guildId: GUILD, channelId: ROUND_CH, starterId: players[0], starterName: 'One' },
			() => 0.3,
			T0
		);
		if (isFail(round)) throw new Error(round.error);
		for (const [i, id] of players.slice(1).entries()) {
			await joinRound(db, discord, round.id, { id, name: `P${i + 2}` }, T0);
		}
		const started = await startRound(
			db,
			discord,
			round.id,
			{ by: players[0], byCrew: false },
			NO_SHUFFLE,
			T0
		);
		if (isFail(started)) throw new Error(started.error);
		return started;
	};
	const turn = (round_id: number) => getRound(db, round_id);

	it('will not open while off, or in the Chain channel, or twice', async () => {
		const ctx = { guildId: GUILD, channelId: ROUND_CH, starterId: 'u1', starterName: 'One' };
		expect(await openRound(db, discord, ctx)).toMatchObject({
			error: expect.stringContaining('not turned on'),
		});
		await enable();
		expect(await openRound(db, discord, { ...ctx, channelId: CHAIN_CH })).toMatchObject({
			error: expect.stringContaining('Chain channel'),
		});
		expect(isFail(await openRound(db, discord, ctx))).toBe(false);
		expect(await openRound(db, discord, ctx)).toMatchObject({
			error: expect.stringContaining('already a Shiritori round'),
		});
	});

	it('posts a lobby card with buttons, and lets players join and leave', async () => {
		await enable();
		const round = await openRound(db, discord, {
			guildId: GUILD,
			channelId: ROUND_CH,
			starterId: 'u1',
			starterName: 'One',
		});
		if (isFail(round)) throw new Error(round.error);
		const card = discord.sent[0].payload;
		expect(card.content).toContain('lobby');
		expect(card.components[0].components.map((c: any) => c.label)).toEqual([
			'Join',
			'Leave',
			'Start',
			'Cancel',
		]);
		expect((await getRound(db, round.id))?.message_id).toBe('bot-1');

		await joinRound(db, discord, round.id, { id: 'u2', name: 'Two' });
		expect(await getPlayers(db, round.id)).toHaveLength(2);
		await leaveRound(db, discord, round.id, 'u2');
		expect(await getPlayers(db, round.id)).toHaveLength(1);
		expect(discord.edits.length).toBeGreaterThan(0);
		// the last player leaving cancels the lobby
		await leaveRound(db, discord, round.id, 'u1');
		expect((await getRound(db, round.id))?.result).toBe('cancelled');
	});

	it('needs two players, and only the starter or Crew can start', async () => {
		await enable();
		const round = await openRound(db, discord, {
			guildId: GUILD,
			channelId: ROUND_CH,
			starterId: 'u1',
			starterName: 'One',
		});
		if (isFail(round)) throw new Error(round.error);
		expect(await startRound(db, discord, round.id, { by: 'u1', byCrew: false })).toMatchObject({
			error: expect.stringContaining('2 players'),
		});
		await joinRound(db, discord, round.id, { id: 'u2', name: 'Two' });
		expect(await startRound(db, discord, round.id, { by: 'u2', byCrew: false })).toMatchObject({
			error: expect.stringContaining('Only the starter'),
		});
		expect(isFail(await startRound(db, discord, round.id, { by: 'u9', byCrew: true }))).toBe(
			false
		);
		expect(await startRound(db, discord, round.id, { by: 'u1', byCrew: false })).toMatchObject({
			error: expect.stringContaining('closed'),
		});
	});

	it('gives the first turn a grace period and lists the channel for the gateway', async () => {
		const round = await start();
		expect(round.status).toBe('running');
		expect(round.current_user_id).toBe('u1');
		expect(Date.parse(round.turn_ends_at!) - T0.getTime()).toBe(
			(round.turn_seconds + START_GRACE_SECONDS) * 1000
		);
		const active = await listActive(db);
		expect(active.chains).toEqual([{ guildId: GUILD, channelId: CHAIN_CH }]);
		expect(active.rounds[0]).toMatchObject({ guildId: GUILD, channelId: ROUND_CH });
	});

	it('only reads the word of the player whose turn it is', async () => {
		const round = await start();
		expect(
			await handleMessage(db, discord, say(ROUND_CH, 'u2', 'apple', at(1)), at(1))
		).toEqual({
			action: 'ignore',
		});
		expect((await turn(round.id))?.turn_no).toBe(0);
		expect(
			await handleMessage(db, discord, say(ROUND_CH, 'u1', 'apple', at(2)), at(2))
		).toEqual({
			action: 'accepted',
		});
		const after = await turn(round.id);
		expect(after).toMatchObject({ turn_no: 1, prev_word: 'apple', current_user_id: 'u2' });
		expect(Date.parse(after!.turn_ends_at!) - at(2).getTime()).toBe(after!.turn_seconds * 1000);
		expect(discord.reactions.at(-1)?.emoji).toBe('✅');
	});

	it('ignores chat from the current player', async () => {
		const round = await start();
		expect(
			await handleMessage(db, discord, say(ROUND_CH, 'u1', 'let me think', at(1)), at(1))
		).toEqual({
			action: 'ignore',
		});
		expect((await turn(round.id))?.current_user_id).toBe('u1');
	});

	it('puts a player out on a bad word, and the last one in wins', async () => {
		const round = await start();
		await handleMessage(db, discord, say(ROUND_CH, 'u1', 'apple', at(1)), at(1));
		const out = await handleMessage(db, discord, say(ROUND_CH, 'u2', 'banana', at(2)), at(2));
		expect(out).toEqual({ action: 'broken', reason: 'bad_start' });
		const done = await turn(round.id);
		expect(done).toMatchObject({ status: 'ended', result: 'winner', winner_id: 'u1' });
		const final = discord.edits.at(-1)!.payload.content;
		expect(final).toContain('<@u1> wins');
		expect(final).toContain('apple');
		const board = await getLeaderboard(db, GUILD);
		expect(board.find((r) => r.user_id === 'u1')).toMatchObject({
			rounds_played: 1,
			rounds_won: 1,
		});
		expect(board.find((r) => r.user_id === 'u2')).toMatchObject({
			rounds_played: 1,
			rounds_won: 0,
		});
		expect(await liveRoundIn(db, GUILD, ROUND_CH)).toBeNull();
	});

	it('counts a dead-letter word, puts the player out, and the next one carries on', async () => {
		const round = await start(['u1', 'u2', 'u3']);
		await handleMessage(db, discord, say(ROUND_CH, 'u1', 'apple', at(1)), at(1));
		await handleMessage(db, discord, say(ROUND_CH, 'u2', 'elephant', at(2)), at(2));
		const out = await handleMessage(db, discord, say(ROUND_CH, 'u3', 'tax', at(3)), at(3));
		expect(out).toEqual({ action: 'ended', reason: 'dead_letter' });
		const players = await getPlayers(db, round.id);
		expect(players.find((p) => p.user_id === 'u3')).toMatchObject({
			state: 'out',
			out_reason: 'dead_letter',
			words: 1,
		});
		const after = await turn(round.id);
		expect(after).toMatchObject({ status: 'running', prev_word: 'tax', current_user_id: 'u1' });
		// a full lap has passed, so the clock dropped a second
		expect(after).toMatchObject({ lap: 1, turn_seconds: 14 });
	});

	it('times a player out when the clock runs out, on a tick and on a late word', async () => {
		const round = await start();
		// within the first turn's grace: nothing happens
		expect(await tickRounds(db, discord, at(20))).toBe(0);
		expect(await tickRounds(db, discord, at(30))).toBe(1);
		expect(await turn(round.id)).toMatchObject({ status: 'ended', winner_id: 'u2' });

		// a second round: the word arrives after the deadline
		const round2 = await start(['u3', 'u4']);
		const late = at(60);
		await handleMessage(db, discord, say(ROUND_CH, 'u3', 'apple', late), late);
		expect(await turn(round2.id)).toMatchObject({ status: 'ended', winner_id: 'u4' });
		expect((await getPlayers(db, round2.id)).find((p) => p.user_id === 'u3')?.out_reason).toBe(
			'timeout'
		);
	});

	it('counts a word sent in time even if it is processed late', async () => {
		const round = await start();
		const out = await handleMessage(
			db,
			discord,
			say(ROUND_CH, 'u1', 'apple', at(10)),
			at(60) // processed long after, but sent inside the first turn
		);
		// the clock is read at the time the member sent it, not the time we got to it
		expect(out).toEqual({ action: 'accepted' });
		expect((await turn(round.id))?.status).toBe('running');
	});

	it('turns a blocked word away without putting anyone out', async () => {
		const round = await start(['u1', 'u2', 'u3'], { blockWords: 'ear' });
		await handleMessage(db, discord, say(ROUND_CH, 'u1', 'apple', at(1)), at(1));
		expect(await handleMessage(db, discord, say(ROUND_CH, 'u2', 'ear', at(2)), at(2))).toEqual({
			action: 'refused',
		});
		expect(await turn(round.id)).toMatchObject({ status: 'running', current_user_id: 'u2' });
		expect((await getPlayers(db, round.id)).every((p) => p.state === 'in')).toBe(true);
	});

	it('puts a player out for a repeat', async () => {
		const round = await start(['u1', 'u2', 'u3']);
		await handleMessage(db, discord, say(ROUND_CH, 'u1', 'apple', at(1)), at(1));
		await handleMessage(db, discord, say(ROUND_CH, 'u2', 'eagle', at(2)), at(2));
		expect(
			await handleMessage(db, discord, say(ROUND_CH, 'u3', 'eagles', at(3)), at(3))
		).toEqual({
			action: 'broken',
			reason: 'repeat',
		});
		expect((await turn(round.id))?.current_user_id).toBe('u1');
	});

	it('does not move the turn twice when a timeout lands after the word', async () => {
		const round = await start(['u1', 'u2', 'u3']);
		const stale = (await turn(round.id)) as Round; // u1 still holds the turn
		await handleMessage(db, discord, say(ROUND_CH, 'u1', 'apple', at(1)), at(1));
		const held = await turn(round.id);
		expect(held?.current_user_id).toBe('u2');
		// a tick that read the round before u1's word now times u1 out
		await eliminate(db, discord, stale, 'u1', 'timeout', at(30));
		const after = await turn(round.id);
		expect(after?.current_user_id).toBe('u2');
		expect(after?.turn_ends_at).toBe(held?.turn_ends_at);
	});

	it('lets a player leave a running round, and passes the turn', async () => {
		const round = await start(['u1', 'u2', 'u3']);
		await leaveRound(db, discord, round.id, 'u1', at(1));
		expect(await turn(round.id)).toMatchObject({ status: 'running', current_user_id: 'u2' });
		await leaveRound(db, discord, round.id, 'u2', at(2));
		expect(await turn(round.id)).toMatchObject({ status: 'ended', winner_id: 'u3' });
	});

	it('closes a lobby nobody started, and a stale one only', async () => {
		await enable();
		const round = await openRound(
			db,
			discord,
			{ guildId: GUILD, channelId: ROUND_CH, starterId: 'u1', starterName: 'One' },
			() => 0.3,
			T0
		);
		if (isFail(round)) throw new Error(round.error);
		expect(
			await sweepShiritori(db, discord, new Date(T0.getTime() + LOBBY_TTL_MS - 1000))
		).toEqual({
			timedOut: 0,
			closedLobbies: 0,
		});
		expect(
			await sweepShiritori(db, discord, new Date(T0.getTime() + LOBBY_TTL_MS + 1000))
		).toEqual({
			timedOut: 0,
			closedLobbies: 1,
		});
		expect((await getRound(db, round.id))?.result).toBe('abandoned');
	});

	it('prunes old word rows of finished games and keeps the summaries', async () => {
		await enable();
		await chainFrom('apple');
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'banana'), T0); // breaks it
		const old = new Date(T0.getTime() + 91 * 86_400_000);
		await sweepShiritori(db, discord, old);
		const rows = await db.prepare(`SELECT COUNT(*) AS n FROM shiritori_words`).first();
		expect(rows?.n).toBe(0);
		expect(await chainRecord(db, GUILD)).toBe(1);
	});
});

describe('cost', () => {
	it('answers the gateway in one read, listing lobbies and running rounds with their status', async () => {
		await enable();
		const round = await openRound(
			db,
			discord,
			{ guildId: GUILD, channelId: ROUND_CH, starterId: 'u1', starterName: 'One' },
			() => 0.3,
			T0
		);
		if (isFail(round)) throw new Error(round.error);
		const prepare = vi.spyOn(db, 'prepare');
		const active = await listActive(db);
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(active.chains).toEqual([{ guildId: GUILD, channelId: CHAIN_CH }]);
		expect(active.rounds).toEqual([
			{
				guildId: GUILD,
				channelId: ROUND_CH,
				status: 'lobby',
				turnEndsAt: null,
				voice: false,
			},
		]);
	});

	it('is one read for an idle minute, and prunes only on the hour', async () => {
		await enable();
		const prepare = vi.spyOn(db, 'prepare');
		await sweepShiritori(db, discord, new Date('2026-10-31T12:30:00Z'));
		expect(prepare).toHaveBeenCalledTimes(1);
		prepare.mockClear();
		await sweepShiritori(db, discord, new Date('2026-10-31T13:00:00Z'));
		expect(prepare).toHaveBeenCalledTimes(3);
	});

	it('keeps old words until the hourly prune', async () => {
		await enable();
		await chainFrom('apple');
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'banana'), T0); // breaks it
		const late = new Date(T0.getTime() + 91 * 86_400_000 + 30 * 60_000);
		await sweepShiritori(db, discord, late); // minute 30: no prune
		expect((await db.prepare(`SELECT COUNT(*) AS n FROM shiritori_words`).first())?.n).toBe(1);
		await sweepShiritori(db, discord, late, true);
		expect((await db.prepare(`SELECT COUNT(*) AS n FROM shiritori_words`).first())?.n).toBe(0);
	});
});

describe('when SpaceBot cannot post', () => {
	const denied = () => {
		const err: any = new Error('Missing Access');
		err.status = 403;
		return err;
	};

	it('records it for the dashboard, once a minute, and saving the settings clears it', async () => {
		await enable();
		await chainFrom('apple');
		discord.channels.react = async () => {
			throw denied();
		};
		const out = await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'eagle'), T0);
		expect(out).toEqual({ action: 'accepted' }); // the game carries on
		const health = await getHealth(db, GUILD);
		expect(health).toMatchObject({
			status: 403,
			channelId: CHAIN_CH,
			message: 'Missing Access',
		});
		expect(health?.hint).toContain('Add Reactions');

		await handleMessage(db, discord, say(CHAIN_CH, 'u2', 'elephant'), T0);
		expect((await getHealth(db, GUILD))?.at).toBe(health?.at); // throttled

		await enable();
		expect(await getHealth(db, GUILD)).toBeNull();
	});

	it('records a failed post too, and says nothing when all is well', async () => {
		await enable();
		expect(await getHealth(db, GUILD)).toBeNull();
		discord.channels.send = async () => {
			throw denied();
		};
		await handleMessage(db, discord, say(CHAIN_CH, 'u1', 'apple'), T0); // opens a chain: posts
		expect((await getHealth(db, GUILD))?.status).toBe(403);
	});
});

describe('/play shiritori', () => {
	const body = (over: Record<string, any> = {}) => ({
		guild_id: GUILD,
		channel_id: ROUND_CH,
		member: { user: { id: 'u1', username: 'one' }, permissions: '0' },
		data: { name: 'play', options: [{ name: 'shiritori', type: 1 }] },
		...over,
	});

	it('opens a lobby, then shows the live round to the next person', async () => {
		await enable();
		const first = await handleShiritoriCommand(body(), db, discord);
		expect(first.response.data.content).toContain('Lobby opened');
		expect(await liveRoundIn(db, GUILD, ROUND_CH)).not.toBeNull();
		const again = await handleShiritoriCommand(body(), db, discord);
		expect(again.response.data.content).toContain('lobby');
		expect(again.response.data.flags).toBe(64);
	});

	it('refuses when Game or Shiritori is off, or outside a server', async () => {
		playEnabled = false;
		expect((await handleShiritoriCommand(body(), db, discord)).response.data.content).toContain(
			'Game is not turned on'
		);
		playEnabled = true;
		expect((await handleShiritoriCommand(body(), db, discord)).response.data.content).toContain(
			'not turned on'
		);
		expect(
			(await handleShiritoriCommand(body({ guild_id: undefined }), db, discord)).response.data
				.content
		).toContain('inside a server');
	});

	it('runs the lobby buttons: join, start, and stop by the starter', async () => {
		await enable();
		await handleShiritoriCommand(body(), db, discord);
		const round = (await liveRoundIn(db, GUILD, ROUND_CH))!;
		const click = (action: string, userId: string, permissions = '0') => ({
			guild_id: GUILD,
			member: { user: { id: userId, username: userId }, permissions },
			data: { custom_id: `shiritori:${action}:${round.id}` },
		});

		const solo = await handleShiritoriComponent(click('start', 'u1'), db, discord);
		expect(solo.response.data.content).toContain('2 players');
		const joined = await handleShiritoriComponent(click('join', 'u2'), db, discord);
		expect(joined.response.type).toBe(7);
		expect(joined.response.data.content).toContain('Players (2)');
		const stranger = await handleShiritoriComponent(click('stop', 'u2'), db, discord);
		expect(stranger.response.data.content).toContain('Only the starter');
		const started = await handleShiritoriComponent(click('start', 'u1'), db, discord);
		expect(started.response.data.content).toContain('turn');
		const stopped = await handleShiritoriComponent(click('stop', 'u1'), db, discord);
		expect(stopped.response.data.content).toContain('cancelled');
		const gone = await handleShiritoriComponent(click('join', 'u3'), db, discord);
		expect(gone.response.data.content).toContain('over');
	});

	it('has a dictionary that knows the words the tests lean on', () => {
		for (const w of ['apple', 'eagle', 'elephant', 'tax', 'tiger', 'rabbit', 'banana']) {
			expect(isWord(w)).toBe(true);
		}
	});
});

describe('migration 0081', () => {
	it('adds the subcommand to the built-in play command, and nothing else', () => {
		const full = readFileSync(
			new URL('../../migrations/0081_shiritori.sql', import.meta.url),
			'utf8'
		);
		const sqlite = createSqliteD1(
			`CREATE TABLE commands (id INTEGER PRIMARY KEY, guild_id TEXT, name TEXT, is_built_in INTEGER, options TEXT);
			 INSERT INTO commands (guild_id, name, is_built_in, options) VALUES
			   ('__built_in__', 'play', 1, '[]'), ('__built_in__', 'timebox', 1, '[]'), ('1', 'play', 0, '[]');`
		);
		sqlite.exec(full);
		return sqlite
			.prepare(`SELECT guild_id, name, options FROM commands ORDER BY id`)
			.all()
			.then(({ results }) => {
				const names = (o: string) => JSON.parse(o).map((x: any) => x.name);
				expect(names(results[0].options)).toEqual(['start', 'stop', 'status', 'shiritori']);
				expect(results[1].options).toBe('[]');
				expect(results[2].options).toBe('[]');
			});
	});
});

describe('voice chat rounds', () => {
	const VC = '300000000000000001';
	const inCall = async (...users: string[]) => {
		await db.prepare(`DELETE FROM live_voice_states WHERE channel_id = ?`).bind(VC).run();
		for (const u of users) {
			await db
				.prepare(
					`INSERT OR REPLACE INTO live_voice_states (guild_id, user_id, channel_id, is_bot) VALUES (?, ?, ?, 0)`
				)
				.bind(GUILD, u, VC)
				.run();
		}
	};
	const slash = (userId: string) => ({
		guild_id: GUILD,
		channel_id: VC,
		member: { user: { id: userId, username: userId }, permissions: '0' },
		data: { name: 'play', options: [{ name: 'shiritori', type: 1 }] },
	});
	/** A voice round with u1, u2 and u3 in the call and in the game. */
	const startVoice = async (
		players = ['u1', 'u2', 'u3'],
		settings: Partial<typeof DEFAULTS> = {}
	) => {
		await enable(settings);
		await inCall(...players);
		const round = await openRound(
			db,
			discord,
			{
				guildId: GUILD,
				channelId: VC,
				starterId: players[0],
				starterName: 'One',
				voice: true,
			},
			() => 0.3,
			T0
		);
		if (isFail(round)) throw new Error(round.error);
		for (const id of players.slice(1))
			await joinRound(db, discord, round.id, { id, name: id }, T0);
		const started = await startRound(
			db,
			discord,
			round.id,
			{ by: players[0], byCrew: false },
			NO_SHUFFLE,
			T0
		);
		if (isFail(started)) throw new Error(started.error);
		discord.sent.length = 0;
		return started;
	};
	const turnOf = async (id: number) => (await getRound(db, id)) as Round;
	const stateOf = async (id: number, user: string) =>
		(await getPlayers(db, id)).find((p) => p.user_id === user);

	it('opens a voice round from inside the call, and nobody is added for being in it', async () => {
		await enable();
		await inCall('u1', 'u2', 'u3');
		const out = await handleShiritoriCommand(slash('u1'), db, discord);
		expect(out.response.data.content).toContain('press Join');
		const round = (await liveRoundIn(db, GUILD, VC))!;
		expect(round.voice).toBe(1);
		expect(await getPlayers(db, round.id)).toHaveLength(1);
		const card = discord.sent[0].payload.content;
		expect(card).toContain('voice chat lobby');
		expect(card).toContain('In the call, not joined: <@u2>, <@u3>');
		expect(card).toContain('anyone who leaves it is skipped');
	});

	it('will not open in a voice channel chat unless you are in the call', async () => {
		await enable();
		await db
			.prepare(
				`INSERT INTO guild_channels (guild_id, channel_id, name, type) VALUES (?, ?, 'General', 2)`
			)
			.bind(GUILD, VC)
			.run();
		const out = await handleShiritoriCommand(slash('u9'), db, discord);
		expect(out.response.data.content).toContain('Join this voice channel first');
		expect(await liveRoundIn(db, GUILD, VC)).toBeNull();
	});

	it('only lets people in the call join', async () => {
		await enable();
		await inCall('u1', 'u2');
		const round = await openRound(db, discord, {
			guildId: GUILD,
			channelId: VC,
			starterId: 'u1',
			starterName: 'One',
			voice: true,
		});
		if (isFail(round)) throw new Error(round.error);
		expect(await joinRound(db, discord, round.id, { id: 'u9', name: 'Out' })).toMatchObject({
			error: expect.stringContaining('Join the voice channel'),
		});
		expect(isFail(await joinRound(db, discord, round.id, { id: 'u2', name: 'Two' }))).toBe(
			false
		);
	});

	it('deals in only the people who joined and are still in the call', async () => {
		await enable();
		await inCall('u1', 'u2', 'u3');
		const round = await openRound(
			db,
			discord,
			{ guildId: GUILD, channelId: VC, starterId: 'u1', starterName: 'One', voice: true },
			() => 0.3,
			T0
		);
		if (isFail(round)) throw new Error(round.error);
		await joinRound(db, discord, round.id, { id: 'u2', name: 'Two' }, T0);
		await joinRound(db, discord, round.id, { id: 'u3', name: 'Three' }, T0);
		await inCall('u1', 'u2'); // u3 left before Start
		await startRound(db, discord, round.id, { by: 'u1', byCrew: false }, NO_SHUFFLE, T0);
		expect((await getPlayers(db, round.id)).map((p) => p.user_id).sort()).toEqual(['u1', 'u2']);
		await inCall('u1'); // not enough left
		const lobby2 = await openRound(db, discord, {
			guildId: GUILD,
			channelId: '400',
			starterId: 'u1',
			starterName: 'One',
		});
		expect(isFail(lobby2)).toBe(false);
	});

	it('refuses to start with fewer than two people in the call', async () => {
		await enable();
		await inCall('u1', 'u2');
		const round = await openRound(db, discord, {
			guildId: GUILD,
			channelId: VC,
			starterId: 'u1',
			starterName: 'One',
			voice: true,
		});
		if (isFail(round)) throw new Error(round.error);
		await joinRound(db, discord, round.id, { id: 'u2', name: 'Two' });
		await inCall('u1');
		expect(await startRound(db, discord, round.id, { by: 'u1', byCrew: false })).toMatchObject({
			error: expect.stringContaining('in the call'),
		});
	});

	it('posts a turn prompt that pings the player, and replaces it each turn', async () => {
		const round = await startVoice();
		expect(discord.sent).toHaveLength(0); // startVoice cleared the lobby traffic
		await handleMessage(db, discord, say(VC, 'u1', 'apple', at(1)), at(1));
		const prompt = discord.sent.at(-1)!;
		expect(prompt.payload.content).toContain('<@u2>');
		expect(prompt.payload.content).toContain('starting with **e**');
		expect(prompt.payload.allowed_mentions).toEqual({ users: ['u2'] });
		await handleMessage(db, discord, say(VC, 'u2', 'eagle', at(2)), at(2));
		expect(discord.sent.at(-1)!.payload.content).toContain('<@u3>');
		expect(discord.deleted).toHaveLength(2); // each prompt took the one before away
		expect((await turnOf(round.id)).turn_message_id).toBeTruthy();
	});

	it('takes the last prompt down when the round ends', async () => {
		const round = await startVoice(['u1', 'u2']);
		await handleMessage(db, discord, say(VC, 'u1', 'apple', at(1)), at(1));
		const before = discord.deleted.length;
		await handleMessage(db, discord, say(VC, 'u2', 'zebra', at(2)), at(2)); // out: u1 wins
		expect((await turnOf(round.id)).status).toBe('ended');
		expect(discord.deleted.length).toBeGreaterThan(before);
	});

	it('skips the player on the clock the moment they leave the call', async () => {
		const round = await startVoice();
		await inCall('u2', 'u3'); // u1, who holds the turn, drops out
		expect(await tickRounds(db, discord, at(5))).toBe(0);
		expect((await turnOf(round.id)).current_user_id).toBe('u2');
		const u1 = await stateOf(round.id, 'u1');
		expect(u1).toMatchObject({ state: 'in' }); // skipped, not yet out
		expect(u1?.away_since).toBeTruthy();
		expect(discord.sent.at(-1)!.payload.content).toContain('<@u2>');
	});

	it('brings them back into the rotation if they return in time', async () => {
		const round = await startVoice();
		await inCall('u2', 'u3');
		await tickRounds(db, discord, at(5));
		await inCall('u1', 'u2', 'u3');
		await tickRounds(db, discord, at(10));
		expect((await stateOf(round.id, 'u1'))?.away_since).toBeNull();
		await handleMessage(db, discord, say(VC, 'u2', 'apple', at(11)), at(11));
		await handleMessage(db, discord, say(VC, 'u3', 'eagle', at(12)), at(12));
		expect((await turnOf(round.id)).current_user_id).toBe('u1'); // u1 is back in the order
	});

	it('puts them out if they stay away past the grace', async () => {
		const round = await startVoice(['u1', 'u2', 'u3'], { turnSeconds: 60 });
		await inCall('u2', 'u3');
		await tickRounds(db, discord, at(5));
		await tickRounds(db, discord, new Date(at(5).getTime() + AWAY_GRACE_MS + 1000));
		expect(await stateOf(round.id, 'u1')).toMatchObject({
			state: 'out',
			out_reason: 'left_call',
		});
		expect((await turnOf(round.id)).status).toBe('running'); // two are left
	});

	it('ends the round with a winner when the call is down to one player', async () => {
		const round = await startVoice(['u1', 'u2'], { turnSeconds: 60 });
		await inCall('u2');
		await tickRounds(db, discord, at(5));
		await tickRounds(db, discord, new Date(at(5).getTime() + AWAY_GRACE_MS + 1000));
		expect(await turnOf(round.id)).toMatchObject({
			status: 'ended',
			result: 'winner',
			winner_id: 'u2',
		});
	});

	it('closes the round when everyone has left the call', async () => {
		const round = await startVoice();
		await inCall();
		await tickRounds(db, discord, at(5));
		expect(await turnOf(round.id)).toMatchObject({ status: 'ended', result: 'abandoned' });
		expect(discord.edits.at(-1)!.payload.content).toContain('Everyone left the call');
	});

	it('ignores a word from a player who has left, and moves on', async () => {
		const round = await startVoice();
		await inCall('u2', 'u3');
		expect(await handleMessage(db, discord, say(VC, 'u1', 'apple', at(3)), at(3))).toEqual({
			action: 'ignore',
		});
		expect((await turnOf(round.id)).current_user_id).toBe('u2');
	});

	it('is checked on every sweep and tick, and listed as a voice round for the gateway', async () => {
		const round = await startVoice();
		expect((await listActive(db)).rounds[0]).toMatchObject({ voice: true, status: 'running' });
		await inCall('u2', 'u3');
		await sweepShiritori(db, discord, at(5));
		expect((await turnOf(round.id)).current_user_id).toBe('u2');
	});

	it('leaves an ordinary text round alone, whoever is in a call', async () => {
		await enable();
		await inCall('u1', 'u2');
		const round = await openRound(
			db,
			discord,
			{ guildId: GUILD, channelId: ROUND_CH, starterId: 'u1', starterName: 'One' },
			() => 0.3,
			T0
		);
		if (isFail(round)) throw new Error(round.error);
		expect(round.voice).toBe(0);
		const { acted } = await syncPresence(db, discord, round, at(5));
		expect(acted).toBe(false);
	});
});
