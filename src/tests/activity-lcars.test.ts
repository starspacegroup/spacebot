import { describe, expect, it } from 'vitest';
import {
	LCARS,
	RESULT_SHOW_MS,
	TB_LONG_BREAK_EVERY,
	avatarColour,
	gameAccent,
	gameScreen,
	initial,
	mmss,
	mss,
	pctLeft,
	tbNext,
	tbSegments,
	viewerAvatar,
	winner,
	type GameRound,
	type GameView,
	type TimeboxLike,
} from '../lib/activity/lcars.js';
import { LONG_BREAK_EVERY, nextStep } from '../lib/server/timebox.js';

const NOW = 1_800_000_000_000;
const unixNow = NOW / 1000;

function round(over: Partial<GameRound> = {}, me: Partial<GameRound['me']> = {}): GameRound {
	return {
		id: 7,
		status: 'running',
		agent_name: 'Agent',
		crew_name: 'Crew',
		min_players: 4,
		calls_per_player: 1,
		started_at: unixNow - 60,
		ends_at: unixNow + 240,
		call_unlocks_at: unixNow,
		is_starter: false,
		players: [],
		meeting: null,
		last_vote: null,
		result: null,
		...over,
		me: {
			in: true,
			state: 'in',
			role: 'crew',
			word: 'nebula',
			calls_left: 1,
			call: 'ok',
			...me,
		},
	};
}
const view = (r: GameRound | null, can_open = false): GameView => ({
	voice_channel_id: 'v',
	can_open,
	round: r,
});

describe('which game screen shows', () => {
	it('loading, none, lobby', () => {
		expect(gameScreen(null)).toBe('loading');
		expect(gameScreen(view(null))).toBe('none');
		expect(gameScreen(view(round({ status: 'lobby' })))).toBe('lobby');
	});

	it('shows the role card first, then the round once it is put away', () => {
		const v = view(round());
		expect(gameScreen(v, {}, NOW)).toBe('card');
		expect(gameScreen(v, { card: 7 }, NOW)).toBe('round');
		// A card put away in another round does not count.
		expect(gameScreen(v, { card: 6 }, NOW)).toBe('card');
	});

	it('an open vote beats the card; being out beats the vote', () => {
		const meeting = {
			id: 1,
			caller_id: 'x',
			closes_at: unixNow + 20,
			voted: 0,
			living: 4,
			my_vote: null,
		};
		expect(gameScreen(view(round({ meeting })), {}, NOW)).toBe('vote');
		expect(gameScreen(view(round({ meeting }, { state: 'ejected' })), {}, NOW)).toBe('out');
	});

	it('someone not in the round watches', () => {
		expect(gameScreen(view(round({}, { in: false, state: null, role: null })))).toBe('watch');
	});

	it('shows a fresh vote result until it is put away or goes stale', () => {
		const last_vote = {
			meeting_id: 3,
			number: 1,
			closed_at: unixNow - 5,
			ejected_id: 'o',
			ejected_name: 'Orion',
		};
		const v = view(round({ last_vote }));
		expect(gameScreen(v, { card: 7 }, NOW)).toBe('ejected');
		expect(gameScreen(v, { card: 7, vote: 3 }, NOW)).toBe('round');
		expect(gameScreen(v, { card: 7 }, NOW + RESULT_SHOW_MS)).toBe('round');
	});

	it('a finished round shows until it is closed', () => {
		const v = view(round({ status: 'ended' }), true);
		expect(gameScreen(v)).toBe('over');
		expect(gameScreen(v, { over: 7 })).toBe('none');
	});
});

describe('state colour', () => {
	it('blue crew, red agent, grey out, lavender result, orange otherwise', () => {
		expect(gameAccent('round', round())).toBe(LCARS.sky);
		expect(gameAccent('card', round({}, { role: 'agent' }))).toBe(LCARS.alert);
		expect(gameAccent('out', round())).toBe(LCARS.grey);
		expect(gameAccent('ejected', round())).toBe(LCARS.lavender);
		expect(gameAccent('vote', round())).toBe(LCARS.orange);
		expect(gameAccent('lobby', round())).toBe(LCARS.orange);
	});

	it('a finished round takes the winner’s colour', () => {
		const res = (code: string) => ({ code, text: '', agent_id: null, word: null, roles: [] });
		expect(gameAccent('over', round({ result: res('players') }))).toBe(LCARS.sky);
		expect(gameAccent('over', round({ result: res('agent_time') }))).toBe(LCARS.alert);
		expect(gameAccent('over', round({ result: res('cancelled') }))).toBe(LCARS.grey);
		expect(winner('agent_parity')).toBe('agent');
	});
});

describe('clocks and faces', () => {
	it('formats clocks', () => {
		expect(mss(222_000)).toBe('3:42');
		expect(mss(-5)).toBe('0:00');
		expect(mmss(524_000)).toBe('08:44');
	});

	it('works out the share of a span left', () => {
		expect(pctLeft(unixNow + 150, 300, NOW)).toBe(50);
		expect(pctLeft(unixNow - 5, 300, NOW)).toBe(0);
		expect(pctLeft(null, 300, NOW)).toBe(0);
	});

	it('initials and colours', () => {
		expect(initial(' nova')).toBe('N');
		expect(initial('')).toBe('?');
		expect(avatarColour('123')).toBe(avatarColour('123'));
	});

	it('builds the viewer avatar only from a real hash and id', () => {
		const hash = 'a'.repeat(32);
		expect(viewerAvatar('123', hash)).toBe(
			`https://cdn.discordapp.com/avatars/123/${hash}.png?size=128`
		);
		expect(viewerAvatar('123', null)).toBeNull();
		expect(viewerAvatar('123', '../../x')).toBeNull();
		expect(viewerAvatar('x/y', hash)).toBeNull();
	});
});

describe('the Timebox tab', () => {
	const tb = (over: Partial<TimeboxLike> = {}): TimeboxLike => ({
		status: 'running',
		phase: 'focus',
		block_number: 3,
		rounds: 4,
		focus_minutes: 20,
		break_minutes: 5,
		long_break_minutes: 15,
		ends_at: unixNow + 5 * 60,
		paused_remaining_ms: null,
		...over,
	});

	it('agrees with the server about what comes next', () => {
		expect(TB_LONG_BREAK_EVERY).toBe(LONG_BREAK_EVERY);
		for (const phase of ['focus', 'break', 'long_break'] as const)
			for (let block = 1; block <= 8; block++) {
				const s = { phase, block_number: block, rounds: 8 };
				const server = nextStep(s);
				const mine = tbNext(tb(s));
				expect(mine?.phase ?? null).toBe(server?.phase ?? null);
			}
		expect(tbNext(tb({ block_number: 4 }))).toBeNull();
		expect(tbNext(tb({ block_number: 2 }))).toEqual({ phase: 'break', minutes: 5 });
	});

	it('fills one bar per block', () => {
		expect(tbSegments(tb(), NOW)).toEqual([1, 1, 0.75, 0]);
		expect(tbSegments(tb({ phase: 'break', block_number: 2 }), NOW)).toEqual([1, 1, 0, 0]);
		expect(
			tbSegments(
				tb({ status: 'paused', ends_at: null, paused_remaining_ms: 20 * 60_000 }),
				NOW
			)
		).toEqual([1, 1, 0, 0]);
	});
});
