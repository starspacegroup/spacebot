import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

let enabled = true;
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: vi.fn(async () => (enabled ? { name: 'play' } : null)),
}));

import {
	EMPTY_GRACE_MS,
	LOBBY_TTL_MS,
	RESTORE_GIVE_UP_MS,
	callCode,
	callVote,
	castVote,
	checkEnd,
	closeMeeting,
	endRound,
	getPlayer,
	getPlayers,
	getRound,
	getSettings,
	handleGameCommand,
	handleGameComponent,
	isCrew,
	isFail,
	joinRound,
	leaveRound,
	liveRoundForVoice,
	openLobby,
	openMeeting,
	resolveDue,
	startRound,
	sweepGame,
	tally,
	upsertSettings,
	DEFAULTS,
	type Round,
} from '../lib/server/game.js';
import { gameAct, gameViewForViewer } from '../lib/server/activity-game.js';

const schema = (file: string, cut?: string) => {
	const sql = readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
	return cut ? sql.split(cut)[0] : sql;
};
const SCHEMA =
	schema('0041_live_voice_states.sql') +
	'ALTER TABLE live_voice_states ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;\n' +
	schema('0076_game.sql', '-- /game as a built-in command family');

const G = '100000000000000001';
const VC = '300000000000000001';
const VC2 = '300000000000000002';
const A = '400000000000000001';
const B = '400000000000000002';
const C = '400000000000000003';
const D = '400000000000000004';
const E = '400000000000000005';
const T0 = new Date('2026-10-15T12:00:00.000Z');
const sec = (n: number) => n * 1000;
const at = (s: number) => new Date(T0.getTime() + sec(s));

function setup(inVoice: string[] = [A, B, C, D], channel = VC) {
	const db: any = createSqliteD1(SCHEMA);
	for (const id of inVoice) putVoice(db, id, channel);
	return db;
}
function putVoice(db: any, id: string, channel = VC, serverMute = 0) {
	db.exec(
		`INSERT OR REPLACE INTO live_voice_states (guild_id, user_id, user_name, display_name, channel_id, server_mute, is_bot)
		 VALUES ('${G}', '${id}', 'u${id.slice(-1)}', 'User ${id.slice(-1)}', '${channel}', ${serverMute}, 0)`
	);
}
function leaveVoice(db: any, id: string) {
	db.exec(`DELETE FROM live_voice_states WHERE user_id = '${id}'`);
}

function fakeDiscord() {
	const d = {
		sent: [] as any[],
		edited: [] as any[],
		mutes: [] as [string, boolean][],
		failMute: null as null | number,
		channels: {
			send: vi.fn(async (_c: string, msg: any) => {
				d.sent.push(msg);
				return { id: `msg${d.sent.length}` };
			}),
			editMessage: vi.fn(async (_c: string, _m: string, patch: any) => {
				d.edited.push(patch);
			}),
		},
		members: {
			setMute: vi.fn(async (_g: string, user: string, mute: boolean) => {
				if (d.failMute) throw Object.assign(new Error('nope'), { status: d.failMute });
				d.mutes.push([user, mute]);
			}),
		},
	};
	return d;
}

/** A lobby with the given players joined and started; agent is the first joined (rng = 0). */
async function running(db: any, discord: any, players = [A, B, C, D], now = T0) {
	const lobby = (await openLobby(
		db,
		discord,
		{
			guildId: G,
			voiceChannelId: VC,
			starterId: players[0],
			starterName: 'User',
		},
		now
	)) as Round;
	for (const p of players.slice(1))
		await joinRound(db, discord, lobby.id, { id: p, name: `User ${p.slice(-1)}` }, now);
	const out = await startRound(db, discord, lobby.id, { by: players[0], rng: () => 0 }, now);
	expect(isFail(out)).toBe(false);
	return out as Round;
}

const vote = (db: any, d: any, id: number, who: string, target: string, now = at(70)) =>
	castVote(db, d, id, who, target, now);

beforeEach(() => {
	enabled = true;
});

describe('rules', () => {
	it('ejects the most-voted player', () => {
		expect(tally([{ target: B }, { target: B }, { target: C }]).ejected).toBe(B);
	});
	it('ejects nobody on a tie for the most', () => {
		expect(tally([{ target: B }, { target: C }]).ejected).toBeNull();
	});
	it('ejects nobody when skip is on top, or tied for it', () => {
		expect(tally([{ target: 'skip' }, { target: 'skip' }, { target: B }]).ejected).toBeNull();
		expect(tally([{ target: 'skip' }, { target: B }]).ejected).toBeNull();
	});
	it('ejects nobody with no votes', () => {
		expect(tally([]).ejected).toBeNull();
	});

	const ends = (extra: Partial<Round> = {}) => ({
		ends_at: at(300).toISOString(),
		agent_id: A,
		...extra,
	});
	const ps = (...states: [string, 'in' | 'ejected'][]) =>
		states.map(([user_id, state]) => ({ user_id, state }));

	it('players win when the agent is out, before anything else', () => {
		expect(checkEnd(ends(), ps([A, 'ejected'], [B, 'in']), at(400))).toBe('players');
	});
	it('the agent wins when only they and one other are left', () => {
		expect(checkEnd(ends(), ps([A, 'in'], [B, 'in'], [C, 'ejected']), at(10))).toBe(
			'agent_parity'
		);
	});
	it('the agent wins when the clock runs out with them still in', () => {
		const three = ps([A, 'in'], [B, 'in'], [C, 'in']);
		expect(checkEnd(ends(), three, at(299))).toBeNull();
		expect(checkEnd(ends(), three, at(300))).toBe('agent_time');
	});
	it('isCrew reads Manage Server, Manage Messages and Administrator', () => {
		expect(isCrew(String(1n << 5n))).toBe(true);
		expect(isCrew(String(1n << 13n))).toBe(true);
		expect(isCrew(String(1n << 3n))).toBe(true);
		expect(isCrew('0')).toBe(false);
	});
});

describe('settings', () => {
	it('falls back to the defaults and round-trips a change', async () => {
		const db = setup();
		expect(await getSettings(db, G)).toMatchObject({
			agentName: 'Agent',
			minPlayers: 4,
			muteOut: true,
		});
		await upsertSettings(db, G, {
			...DEFAULTS,
			agentName: 'Impostor',
			minPlayers: 3,
			muteOut: false,
		});
		expect(await getSettings(db, G)).toMatchObject({
			agentName: 'Impostor',
			minPlayers: 3,
			muteOut: false,
		});
	});

	it('a round keeps the settings it opened with', async () => {
		const db = setup();
		await upsertSettings(db, G, { ...DEFAULTS, agentName: 'Impostor' });
		const r = (await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC,
			starterId: A,
			starterName: 'a',
		})) as Round;
		await upsertSettings(db, G, { ...DEFAULTS, agentName: 'Changeling', minPlayers: 9 });
		const fresh = (await getRound(db, r.id)) as Round;
		expect(fresh.agent_name).toBe('Impostor');
		expect(fresh.min_players).toBe(4);
	});
});

describe('the lobby', () => {
	it('opens with the starter in it and posts a card', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = (await openLobby(db, d, {
			guildId: G,
			voiceChannelId: VC,
			starterId: A,
			starterName: 'a',
		})) as Round;
		expect(r.status).toBe('lobby');
		expect((await getPlayers(db, r.id)).map((p) => p.user_id)).toEqual([A]);
		expect(d.channels.send).toHaveBeenCalledWith(
			VC,
			expect.objectContaining({ components: expect.any(Array) })
		);
		expect((await getRound(db, r.id))!.message_id).toBe('msg1');
	});

	it('refuses a second live round in the same voice channel, allows another channel', async () => {
		const db = setup([A, B], VC);
		putVoice(db, C, VC2);
		await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC,
			starterId: A,
			starterName: 'a',
		});
		const again = await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC,
			starterId: B,
			starterName: 'b',
		});
		expect(isFail(again)).toBe(true);
		const other = await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC2,
			starterId: C,
			starterName: 'c',
		});
		expect(isFail(other)).toBe(false);
	});

	it('only lets someone in that voice channel join', async () => {
		const db = setup([A, B]);
		putVoice(db, C, VC2);
		const r = (await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC,
			starterId: A,
			starterName: 'a',
		})) as Round;
		expect(isFail(await joinRound(db, null, r.id, { id: C, name: 'c' }))).toBe(true);
		expect(isFail(await joinRound(db, null, r.id, { id: B, name: 'b' }))).toBe(false);
		// Joining twice is harmless.
		await joinRound(db, null, r.id, { id: B, name: 'b' });
		expect(await getPlayers(db, r.id)).toHaveLength(2);
	});

	it('cancels when the last player leaves', async () => {
		const db = setup([A]);
		const r = (await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC,
			starterId: A,
			starterName: 'a',
		})) as Round;
		await leaveRound(db, null, r.id, A);
		expect((await getRound(db, r.id))!.status).toBe('ended');
		expect((await getRound(db, r.id))!.result).toBe('cancelled');
		expect(await liveRoundForVoice(db, G, VC)).toBeNull();
	});
});

describe('the deal', () => {
	it('needs the minimum number of players, counting only those still in the voice channel', async () => {
		const db = setup([A, B, C, D]);
		const r = (await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC,
			starterId: A,
			starterName: 'a',
		})) as Round;
		for (const p of [B, C, D]) await joinRound(db, null, r.id, { id: p, name: 'x' });
		leaveVoice(db, D);
		const out = await startRound(db, null, r.id, { by: A });
		expect(isFail(out)).toBe(true);
		expect((out as any).error).toMatch(/Needs 4 players/);
		expect((await getRound(db, r.id))!.status).toBe('lobby');
	});

	it('deals exactly one agent and the same word to everyone else, and drops players who left', async () => {
		const db = setup([A, B, C, D, E]);
		const r = (await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC,
			starterId: A,
			starterName: 'a',
		})) as Round;
		for (const p of [B, C, D, E]) await joinRound(db, null, r.id, { id: p, name: 'x' });
		leaveVoice(db, E);
		const started = (await startRound(db, null, r.id, { by: A, rng: () => 0 })) as Round;
		expect(started.status).toBe('running');
		expect(started.word).toBeTruthy();
		const players = await getPlayers(db, r.id);
		expect(players.map((p) => p.user_id)).not.toContain(E);
		expect(players.filter((p) => p.role === 'agent')).toHaveLength(1);
		expect(players.filter((p) => p.role === 'crew')).toHaveLength(3);
		expect(started.agent_id).toBe(players.find((p) => p.role === 'agent')!.user_id);
		expect(started.ends_at).toBeTruthy();
	});

	it('deals every seat over many rounds, not always the first', async () => {
		const seen = new Set<string>();
		for (let i = 0; i < 40; i++) {
			const db = setup();
			const r = (await openLobby(db, null, {
				guildId: G,
				voiceChannelId: VC,
				starterId: A,
				starterName: 'a',
			})) as Round;
			for (const p of [B, C, D]) await joinRound(db, null, r.id, { id: p, name: 'x' });
			seen.add(((await startRound(db, null, r.id, { by: A })) as Round).agent_id!);
		}
		expect(seen.size).toBeGreaterThan(1);
	});

	it('lets only the starter or Crew start, and deals once', async () => {
		const db = setup();
		const r = (await openLobby(db, null, {
			guildId: G,
			voiceChannelId: VC,
			starterId: A,
			starterName: 'a',
		})) as Round;
		for (const p of [B, C, D]) await joinRound(db, null, r.id, { id: p, name: 'x' });
		expect(isFail(await startRound(db, null, r.id, { by: B }))).toBe(true);
		expect(
			isFail(await startRound(db, null, r.id, { by: B, byCrew: true, rng: () => 0 }))
		).toBe(false);
		const word = (await getRound(db, r.id))!.word;
		expect(isFail(await startRound(db, null, r.id, { by: A }))).toBe(true);
		expect((await getRound(db, r.id))!.word).toBe(word);
	});
});

describe('calling and casting a vote', () => {
	it('is locked until the lock passes, then allowed once per player', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = await running(db, d);
		const early = await callVote(db, d, r.id, B, at(30));
		expect(isFail(early)).toBe(true);
		expect(callCode(r, await getPlayer(db, r.id, B), false, at(30))).toBe('locked');

		const m = await callVote(db, d, r.id, B, at(61));
		expect(isFail(m)).toBe(false);
		expect(await getPlayer(db, r.id, B)).toMatchObject({ calls_used: 1 });
		// A second call while open is refused and does not spend the call.
		expect(isFail(await callVote(db, d, r.id, C, at(62)))).toBe(true);
		expect(await getPlayer(db, r.id, C)).toMatchObject({ calls_used: 0 });
		// Close it with everyone skipping; B has spent the one call.
		for (const p of [A, B, C, D]) await vote(db, d, r.id, p, 'skip', at(63));
		expect(await openMeeting(db, r.id)).toBeNull();
		const again = await callVote(db, d, r.id, B, at(70));
		expect(isFail(again)).toBe(true);
		expect((again as any).error).toMatch(/used your call/);
	});

	it('posts a public line when a vote is called', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = await running(db, d);
		d.sent.length = 0;
		await callVote(db, d, r.id, B, at(61));
		expect(d.sent[0].content).toContain(`<@${B}> called a vote`);
	});

	it('only lets living players vote, for a living player other than themselves, and lets them change it', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = await running(db, d);
		await callVote(db, d, r.id, B, at(61));
		expect(isFail(await vote(db, d, r.id, E, C, at(62)))).toBe(true); // not a player
		expect(isFail(await vote(db, d, r.id, B, B, at(62)))).toBe(true); // self
		expect(isFail(await vote(db, d, r.id, B, E, at(62)))).toBe(true); // not in the round
		expect(isFail(await vote(db, d, r.id, B, C, at(62)))).toBe(false);
		expect(isFail(await vote(db, d, r.id, B, D, at(63)))).toBe(false);
		const rows = await db.prepare('SELECT * FROM game_votes').all();
		expect(rows.results).toHaveLength(1);
		expect(rows.results[0].target).toBe(D);
	});

	it('closes at the deadline when not everyone voted', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = await running(db, d);
		await callVote(db, d, r.id, B, at(61));
		await vote(db, d, r.id, B, C, at(62));
		await vote(db, d, r.id, D, C, at(63));
		expect(await openMeeting(db, r.id)).not.toBeNull();
		await resolveDue(db, d, (await getRound(db, r.id)) as Round, at(61 + 31));
		expect(await openMeeting(db, r.id)).toBeNull();
		expect(await getPlayer(db, r.id, C)).toMatchObject({ state: 'ejected' });
	});

	it('closing twice ejects once', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = await running(db, d);
		await callVote(db, d, r.id, B, at(61));
		await vote(db, d, r.id, B, C, at(62));
		const meeting = (await openMeeting(db, r.id))!;
		const round = (await getRound(db, r.id)) as Round;
		await Promise.all([
			closeMeeting(db, d, round, meeting, at(100)),
			closeMeeting(db, d, round, meeting, at(100)),
		]);
		expect(d.mutes.filter(([u]) => u === C)).toHaveLength(1);
	});
});

describe('ejections and the end of a round', () => {
	it('ejecting a crew player mutes them and the round goes on', async () => {
		const db = setup([A, B, C, D, E]);
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D, E]);
		await callVote(db, d, r.id, B, at(61));
		for (const p of [A, B, D, E]) await vote(db, d, r.id, p, C, at(62));
		await vote(db, d, r.id, C, 'skip', at(62));
		expect(await getPlayer(db, r.id, C)).toMatchObject({
			state: 'ejected',
			muted: 1,
			prev_mute: 0,
		});
		expect(d.mutes).toContainEqual([C, true]);
		expect((await getRound(db, r.id))!.status).toBe('running');
		expect(d.sent.at(-1).content).toContain('not** the Agent');
	});

	it('ejecting the agent ends the round for the players and lifts every mute', async () => {
		const db = setup([A, B, C, D, E]);
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D, E]); // A is the agent
		// First eject a crew player so there is a mute to lift.
		await callVote(db, d, r.id, B, at(61));
		for (const p of [A, B, D, E]) await vote(db, d, r.id, p, C, at(62));
		await vote(db, d, r.id, C, 'skip', at(62));
		await callVote(db, d, r.id, D, at(70));
		for (const p of [B, D, E]) await vote(db, d, r.id, p, A, at(71));
		await vote(db, d, r.id, A, 'skip', at(71));
		const ended = (await getRound(db, r.id)) as Round;
		expect(ended).toMatchObject({ status: 'ended', result: 'players' });
		expect(d.mutes).toContainEqual([C, false]);
		expect(await getPlayer(db, r.id, C)).toMatchObject({ muted: 0 });
		expect(d.sent.at(-1).content).toContain(`<@${A}>`);
		expect(d.sent.at(-1).content).toContain(ended.word!);
	});

	it('leaves a mute a moderator set alone', async () => {
		const db = setup([A, B, C, D, E]);
		putVoice(db, C, VC, 1); // already server-muted
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D, E]);
		await callVote(db, d, r.id, B, at(61));
		for (const p of [A, B, D, E]) await vote(db, d, r.id, p, C, at(62));
		await vote(db, d, r.id, C, 'skip', at(62));
		expect(await getPlayer(db, r.id, C)).toMatchObject({ muted: 1, prev_mute: 1 });
		expect(d.mutes).toEqual([]); // never touched
		await endRound(db, d, (await getRound(db, r.id)) as Round, 'cancelled', at(90));
		expect(d.mutes).toEqual([]); // and not lifted
	});

	it('does not mute when the server turned that off', async () => {
		const db = setup([A, B, C, D, E]);
		await upsertSettings(db, G, { ...DEFAULTS, muteOut: false });
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D, E]);
		await callVote(db, d, r.id, B, at(61));
		for (const p of [A, B, D, E]) await vote(db, d, r.id, p, C, at(62));
		await vote(db, d, r.id, C, 'skip', at(62));
		expect(await getPlayer(db, r.id, C)).toMatchObject({ state: 'ejected', muted: 0 });
		expect(d.mutes).toEqual([]);
	});

	it('the agent wins by parity when two are left', async () => {
		const db = setup([A, B, C, D]);
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D]);
		await callVote(db, d, r.id, B, at(61));
		for (const p of [A, B, D]) await vote(db, d, r.id, p, C, at(62));
		await vote(db, d, r.id, C, 'skip', at(62));
		// Three left: agent + B + D. Eject another crew player.
		await callVote(db, d, r.id, D, at(70));
		for (const p of [A, D]) await vote(db, d, r.id, p, B, at(71));
		await vote(db, d, r.id, B, 'skip', at(71));
		expect(await getRound(db, r.id)).toMatchObject({ status: 'ended', result: 'agent_parity' });
	});

	it('the agent wins when the clock runs out, but a vote in progress closes first', async () => {
		const db = setup([A, B, C, D, E]);
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D, E]);
		await callVote(db, d, r.id, B, at(290));
		await resolveDue(db, d, (await getRound(db, r.id)) as Round, at(310));
		expect(await getRound(db, r.id)).toMatchObject({ status: 'running' }); // meeting open until 320
		await resolveDue(db, d, (await getRound(db, r.id)) as Round, at(321));
		expect(await getRound(db, r.id)).toMatchObject({ status: 'ended', result: 'agent_time' });
	});

	it('ending twice posts the result once', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = await running(db, d);
		d.sent.length = 0;
		const round = (await getRound(db, r.id)) as Round;
		await Promise.all([
			endRound(db, d, round, 'agent_time', at(300)),
			endRound(db, d, round, 'agent_time', at(300)),
		]);
		expect(d.sent.filter((m) => /wins|win:/.test(m.content))).toHaveLength(1);
	});
});

describe('the sweep', () => {
	it('closes a lobby nobody started', async () => {
		const db = setup([A]);
		const d = fakeDiscord();
		const r = (await openLobby(
			db,
			d,
			{ guildId: G, voiceChannelId: VC, starterId: A, starterName: 'a' },
			T0
		)) as Round;
		await sweepGame(db, d, new Date(T0.getTime() + LOBBY_TTL_MS - 1000));
		expect((await getRound(db, r.id))!.status).toBe('lobby');
		const out = await sweepGame(db, d, new Date(T0.getTime() + LOBBY_TTL_MS + 1000));
		expect(out.lobbies_closed).toBe(1);
		expect((await getRound(db, r.id))!.result).toBe('cancelled');
	});

	it('resolves a round whose clock ran out', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = await running(db, d);
		const out = await sweepGame(db, d, at(301));
		expect(out.resolved).toBe(1);
		expect((await getRound(db, r.id))!.result).toBe('agent_time');
	});

	it('ends a round when the voice channel stays empty past the grace period', async () => {
		const db = setup();
		const d = fakeDiscord();
		const r = await running(db, d);
		for (const p of [A, B, C, D]) leaveVoice(db, p);
		await sweepGame(db, d, at(10));
		expect((await getRound(db, r.id))!.status).toBe('running');
		const out = await sweepGame(db, d, new Date(at(10).getTime() + EMPTY_GRACE_MS + 1000));
		expect(out.abandoned).toBe(1);
		expect((await getRound(db, r.id))!.result).toBe('abandoned');
	});

	it('retries a lift Discord refused, then stops after the give-up window', async () => {
		const db = setup([A, B, C, D, E]);
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D, E]);
		await callVote(db, d, r.id, B, at(61));
		for (const p of [A, B, D, E]) await vote(db, d, r.id, p, C, at(62));
		await vote(db, d, r.id, C, 'skip', at(62));
		// C leaves voice, then the round ends: Discord refuses the unmute.
		leaveVoice(db, C);
		d.failMute = 400;
		await endRound(db, d, (await getRound(db, r.id)) as Round, 'cancelled', at(100));
		expect(await getPlayer(db, r.id, C)).toMatchObject({ muted: 1, restore_pending: 1 });
		// Still refused: stays pending.
		expect((await sweepGame(db, d, at(160))).restored).toBe(0);
		// C comes back; the next sweep lifts it.
		d.failMute = null;
		putVoice(db, C);
		expect((await sweepGame(db, d, at(220))).restored).toBe(1);
		expect(d.mutes).toContainEqual([C, false]);
		expect(await getPlayer(db, r.id, C)).toMatchObject({ muted: 0, restore_pending: 0 });
	});

	it('gives up on a lift that never works', async () => {
		const db = setup([A, B, C, D, E]);
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D, E]);
		await callVote(db, d, r.id, B, at(61));
		for (const p of [A, B, D, E]) await vote(db, d, r.id, p, C, at(62));
		await vote(db, d, r.id, C, 'skip', at(62));
		leaveVoice(db, C);
		d.failMute = 400;
		await endRound(db, d, (await getRound(db, r.id)) as Round, 'cancelled', at(100));
		const out = await sweepGame(db, d, new Date(at(100).getTime() + RESTORE_GIVE_UP_MS + 1000));
		expect(out.restore_failed).toBe(1);
		expect(await getPlayer(db, r.id, C)).toMatchObject({ restore_pending: 0 });
	});

	it('mutes an ejected player who was not in voice when ejected, once they are', async () => {
		const db = setup([A, B, C, D, E]);
		const d = fakeDiscord();
		const r = await running(db, d, [A, B, C, D, E]);
		leaveVoice(db, C);
		await callVote(db, d, r.id, B, at(61));
		for (const p of [A, B, D, E]) await vote(db, d, r.id, p, C, at(62));
		// C was not there to vote, so the vote waits for its deadline.
		await resolveDue(db, d, (await getRound(db, r.id)) as Round, at(61 + 31));
		expect(await getPlayer(db, r.id, C)).toMatchObject({ state: 'ejected', muted: 0 });
		putVoice(db, C);
		expect((await sweepGame(db, d, at(70))).muted).toBe(1);
		expect(d.mutes).toContainEqual([C, true]);
	});

	it('does nothing, cheaply, when nothing is live', async () => {
		const db = setup();
		const d = fakeDiscord();
		expect(await sweepGame(db, d, T0)).toMatchObject({ resolved: 0, abandoned: 0 });
	});
});

describe('Discord command and buttons', () => {
	const body = (extra: any = {}) => ({
		guild_id: G,
		channel_id: VC,
		member: { user: { id: A, username: 'a' }, permissions: '0' },
		data: { name: 'play', options: [{ type: 1, name: 'start', options: [] }] },
		...extra,
	});

	it('/game start opens a lobby for the voice channel the member is in', async () => {
		const db = setup([A, B]);
		const d = fakeDiscord();
		const out = await handleGameCommand(body(), db, d);
		expect(out.response.data.content).toMatch(/Lobby opened/);
		expect(await liveRoundForVoice(db, G, VC)).not.toBeNull();
	});

	it('/game start needs a voice channel, and the module on', async () => {
		const db = setup([]);
		expect((await handleGameCommand(body(), db, fakeDiscord())).response.data.content).toMatch(
			/Join a voice channel/
		);
		enabled = false;
		expect(
			(await handleGameCommand(body(), setup([A]), fakeDiscord())).response.data.content
		).toMatch(/not turned on/);
	});

	it('/game stop ends it for the starter or Crew, not for others', async () => {
		const db = setup([A, B]);
		const d = fakeDiscord();
		await handleGameCommand(body(), db, d);
		const stop = (id: string, permissions = '0') =>
			handleGameCommand(
				body({
					member: { user: { id, username: 'x' }, permissions },
					data: { name: 'play', options: [{ type: 1, name: 'stop' }] },
				}),
				db,
				d
			);
		expect((await stop(B)).response.data.content).toMatch(/Only the starter or Crew/);
		expect((await stop(B, String(1n << 5n))).response.data.content).toMatch(/Round ended/);
	});

	it('the Join and Start buttons work, with the lobby card as the reply', async () => {
		const db = setup([A, B, C, D]);
		const d = fakeDiscord();
		await handleGameCommand(body(), db, d);
		const round = (await liveRoundForVoice(db, G, VC)) as Round;
		const press = (id: string, action: string) =>
			handleGameComponent(
				{
					guild_id: G,
					member: { user: { id, username: 'x' }, permissions: '0' },
					data: { custom_id: `game:${action}:${round.id}` },
				},
				db,
				d
			);
		for (const id of [B, C, D]) expect((await press(id, 'join')).response.type).toBe(7);
		expect((await press(B, 'start')).response.data.content).toMatch(
			/Only the person who opened/
		);
		expect((await press(A, 'start')).response.type).toBe(7);
		expect((await getRound(db, round.id))!.status).toBe('running');
	});
});

describe('what the Activity may see and do', () => {
	const claims = (u: string, c = VC): any => ({ u, i: 'i', k: 'guild', g: [G], c, e: 9e9 });

	async function game(players = [A, B, C, D]) {
		const db = setup(players);
		const d = fakeDiscord();
		const r = await running(db, d, players);
		return { db, d, r };
	}

	it('tells the agent they are the agent and does not send them the word', async () => {
		const { db, d, r } = await game();
		const v = await gameViewForViewer(db, d, claims(A), G, at(5));
		expect(v.round!.me).toMatchObject({ role: 'agent', word: null });
		expect(JSON.stringify(v)).not.toContain(r.word!);
	});

	it('gives everyone else the word, and not who the agent is', async () => {
		const { db, d, r } = await game();
		const v = await gameViewForViewer(db, d, claims(B), G, at(5));
		expect(v.round!.me).toMatchObject({ role: 'crew', word: r.word });
		expect(JSON.stringify(v.round!.players)).not.toMatch(/agent|crew/);
		expect(v.round!.result).toBeNull();
		expect(JSON.stringify(v)).not.toContain(`"agent_id"`);
	});

	it('reveals everything once the round ends', async () => {
		const { db, d, r } = await game();
		await endRound(db, d, (await getRound(db, r.id)) as Round, 'agent_time', at(300));
		const v = await gameViewForViewer(db, d, claims(B), G, at(310));
		expect(v.round!.result).toMatchObject({ code: 'agent_time', agent_id: A, word: r.word });
		expect(v.round!.result!.roles.find((p) => p.id === A)!.role).toBe('agent');
	});

	it('stops showing a finished round after a while', async () => {
		const { db, d, r } = await game();
		await endRound(db, d, (await getRound(db, r.id)) as Round, 'agent_time', at(300));
		const v = await gameViewForViewer(db, d, claims(B), G, at(300 + 11 * 60));
		expect(v.round).toBeNull();
	});

	it('offers a lobby to someone in a voice channel with no round, and not to someone outside one', async () => {
		const db = setup([A]);
		expect((await gameViewForViewer(db, null, claims(A), G, T0)).can_open).toBe(true);
		expect((await gameViewForViewer(db, null, claims(B, VC), G, T0)).can_open).toBe(false);
	});

	it('shows the open vote without who voted for whom', async () => {
		const { db, d, r } = await game();
		await callVote(db, d, r.id, B, at(61));
		await vote(db, d, r.id, C, D, at(62));
		const v = await gameViewForViewer(db, d, claims(C), G, at(63));
		expect(v.round!.meeting).toMatchObject({ caller_id: B, voted: 1, living: 4, my_vote: D });
		const other = await gameViewForViewer(db, d, claims(B), G, at(63));
		expect(other.round!.meeting).toMatchObject({ voted: 1, my_vote: null });
	});

	it('refuses a server that is not in the session, or has the game off', async () => {
		const db = setup([A]);
		await expect(gameViewForViewer(db, null, { ...claims(A), g: [] }, G)).rejects.toMatchObject(
			{ status: 403 }
		);
		enabled = false;
		await expect(gameViewForViewer(db, null, claims(A), G)).rejects.toMatchObject({
			status: 403,
		});
	});

	it('plays a whole lobby through the moves', async () => {
		const db = setup([A, B, C, D]);
		const d = fakeDiscord();
		expect(await gameAct(db, d, claims(A), G, { action: 'open' }, T0)).toEqual({ ok: true });
		const round = (await liveRoundForVoice(db, G, VC)) as Round;
		for (const u of [B, C, D])
			expect(
				await gameAct(db, d, claims(u), G, { action: 'join', round_id: round.id }, T0)
			).toEqual({ ok: true });
		expect(
			await gameAct(db, d, claims(B), G, { action: 'start', round_id: round.id }, T0)
		).toMatchObject({ error: expect.any(String) });
		expect(
			await gameAct(db, d, claims(A), G, { action: 'start', round_id: round.id }, T0)
		).toEqual({ ok: true });
		expect(
			await gameAct(db, d, claims(B), G, { action: 'call', round_id: round.id }, at(61))
		).toEqual({ ok: true });
		expect(
			await gameAct(
				db,
				d,
				claims(B),
				G,
				{ action: 'vote', round_id: round.id, target: 'skip' },
				at(62)
			)
		).toEqual({ ok: true });
	});

	it('will not touch a round in another server', async () => {
		const { db, d, r } = await game();
		const out = await gameAct(
			db,
			d,
			{ ...claims(A), g: ['999999999999999999'] },
			'999999999999999999',
			{ action: 'stop', round_id: r.id }
		);
		expect(out).toMatchObject({ error: expect.any(String) });
		expect(await getRound(db, r.id)).toMatchObject({ status: 'running' });
	});
});
