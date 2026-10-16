/**
 * The Activity's LCARS screens: which screen to show, its state colour, and the
 * small sums behind the clocks and bars. Pure functions, so the rules are tested
 * without a browser (src/tests/activity-lcars.test.ts).
 *
 * Nothing here decides what a viewer may know. The server's view
 * (src/lib/server/activity-game.ts) already holds back other players' roles and
 * the word; these functions only pick how to draw what arrived.
 */

export type Choice = 'yes' | 'no' | 'abstain';

export type GamePlayer = {
	id: string;
	name: string;
	state: 'in' | 'ejected';
	avatar?: string | null;
	voice?: 'here' | 'away';
	muted?: boolean;
};

export type GameRound = {
	id: number;
	status: 'lobby' | 'running' | 'ended';
	agent_name: string;
	crew_name: string;
	min_players: number;
	calls_per_player: number;
	started_at: number | null;
	ends_at: number | null;
	call_unlocks_at: number | null;
	is_starter: boolean;
	starter_id?: string;
	voice_channel_name?: string | null;
	round_seconds?: number;
	call_lock_seconds?: number;
	meeting_seconds?: number;
	mute_out?: boolean;
	players: GamePlayer[];
	me: {
		in: boolean;
		state: 'in' | 'ejected' | null;
		role: 'agent' | 'crew' | null;
		word: string | null;
		calls_left: number;
		call: 'ok' | 'no_round' | 'not_in' | 'out' | 'open' | 'locked' | 'used';
	};
	meeting: null | {
		id: number;
		caller_id: string;
		closes_at: number;
		voted: number;
		living: number;
		my_vote: string | null;
		voted_ids?: string[];
	};
	last_vote: null | {
		meeting_id?: number;
		number?: number;
		closed_at?: number | null;
		ejected_id: string | null;
		ejected_name: string | null;
	};
	result: null | {
		code: string;
		text: string;
		agent_id: string | null;
		word: string | null;
		roles: {
			id: string;
			name: string;
			role: 'agent' | 'crew' | null;
			state: string;
			avatar?: string | null;
		}[];
	};
};

export type GameView = {
	voice_channel_id: string | null;
	can_open: boolean;
	round: GameRound | null;
};

/** What a tab tells the frame: its title, state colour, the active tab's colour, the footer. */
export type Frame = { title: string; accent: string; tab: string | null; footer: string };

/** What the viewer has already put away: their role card, a vote's result, a finished round. */
export type Dismissed = { card?: number | null; vote?: number | null; over?: number | null };

export type GameScreen =
	'loading' | 'none' | 'lobby' | 'card' | 'round' | 'vote' | 'ejected' | 'out' | 'watch' | 'over';

/** How long a vote's result takes the screen before the round view comes back by itself. */
export const RESULT_SHOW_MS = 60_000;

/**
 * Which screen the Game tab shows. Order matters: being out beats everything (an
 * ejected player cannot vote), an open vote beats the role card, and the card
 * beats a vote's result.
 */
export function gameScreen(
	view: GameView | null,
	dismissed: Dismissed = {},
	nowMs = Date.now()
): GameScreen {
	if (!view) return 'loading';
	const r = view.round;
	if (!r) return 'none';
	if (r.status === 'lobby') return 'lobby';
	if (r.status === 'ended') return dismissed.over === r.id ? 'none' : 'over';
	if (!r.me.in) return 'watch';
	if (r.me.state === 'ejected') return 'out';
	if (r.meeting) return 'vote';
	if (dismissed.card !== r.id) return 'card';
	const lv = r.last_vote;
	if (
		lv &&
		lv.meeting_id != null &&
		dismissed.vote !== lv.meeting_id &&
		lv.closed_at != null &&
		nowMs - lv.closed_at * 1000 < RESULT_SHOW_MS
	)
		return 'ejected';
	return 'round';
}

/** Which side won a finished round, from its result code. */
export function winner(code: string | null | undefined): 'crew' | 'agent' | 'none' {
	if (code === 'players') return 'crew';
	if (code === 'agent_time' || code === 'agent_parity') return 'agent';
	return 'none';
}

/** The LCARS palette. One place, so a screen's state colour is a name, not a hex. */
export const LCARS = {
	orange: '#ff9900',
	peach: '#ffcc99',
	lavender: '#cc99cc',
	violet: '#9999ff',
	red: '#cc5555',
	alert: '#ff5555',
	gold: '#ffcc66',
	sky: '#99ccff',
	grey: '#888888',
} as const;

/**
 * A screen's state colour: blue for crew, red for the agent, grey for out,
 * orange while the table acts (lobby, vote), lavender for a vote's result.
 */
export function gameAccent(screen: GameScreen, round: GameRound | null): string {
	const role = round?.me.role;
	switch (screen) {
		case 'card':
		case 'round':
			return role === 'agent' ? LCARS.alert : LCARS.sky;
		case 'out':
		case 'watch':
			return LCARS.grey;
		case 'ejected':
			return LCARS.lavender;
		case 'over': {
			const w = winner(round?.result?.code);
			return w === 'crew' ? LCARS.sky : w === 'agent' ? LCARS.alert : LCARS.grey;
		}
		default:
			return LCARS.orange;
	}
}

/** `m:ss` for a game clock. */
export function mss(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `mm:ss`, the Timebox's clock. */
export function mmss(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Time left until a unix-seconds deadline. */
export function msUntil(unix: number | null | undefined, nowMs: number): number {
	return unix ? Math.max(0, unix * 1000 - nowMs) : 0;
}

/** Share of a span still left, 0–100, for a clock's bar. */
export function pctLeft(
	endUnix: number | null | undefined,
	spanSeconds: number | null | undefined,
	nowMs: number
): number {
	if (!endUnix || !spanSeconds) return 0;
	return Math.max(0, Math.min(100, (msUntil(endUnix, nowMs) / (spanSeconds * 1000)) * 100));
}

/** A player's first letter, for an avatar with no image. */
export function initial(name: string | null | undefined): string {
	const ch = Array.from((name ?? '').trim())[0];
	return ch ? ch.toUpperCase() : '?';
}

/** A stable avatar colour for a player without an image, from their id. */
export function avatarColour(id: string): string {
	const set = [LCARS.peach, LCARS.lavender, LCARS.violet, LCARS.gold, '#ff9966', LCARS.sky];
	let h = 0;
	for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return set[h % set.length];
}

/** The viewer's Discord avatar from the session (a hash), or null. */
export function viewerAvatar(id: string, hash: string | null | undefined): string | null {
	if (!hash || !/^(a_)?[0-9a-f]{32}$/.test(hash) || !/^\d+$/.test(id)) return null;
	return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`;
}

// --- Timebox ------------------------------------------------------------------

/** Same as LONG_BREAK_EVERY in src/lib/server/timebox.ts (a test keeps them equal). */
export const TB_LONG_BREAK_EVERY = 4;

export type TimeboxLike = {
	status: 'running' | 'paused' | 'done' | 'stopped';
	phase: 'focus' | 'break' | 'long_break';
	block_number: number;
	rounds: number;
	focus_minutes: number;
	break_minutes: number;
	long_break_minutes: number;
	ends_at: number | null;
	paused_remaining_ms: number | null;
};

export const TB_PHASE = { focus: 'Focus', break: 'Break', long_break: 'Long break' } as const;

/** Milliseconds left in the current block. */
export function tbLeft(tb: TimeboxLike, nowMs: number): number {
	return tb.status === 'paused' ? (tb.paused_remaining_ms ?? 0) : msUntil(tb.ends_at, nowMs);
}

function tbMinutes(tb: TimeboxLike, phase: TimeboxLike['phase']): number {
	return phase === 'focus'
		? tb.focus_minutes
		: phase === 'long_break'
			? tb.long_break_minutes
			: tb.break_minutes;
}

/** What follows this block, as the server's nextStep decides it; null after the last block. */
export function tbNext(tb: TimeboxLike): { phase: TimeboxLike['phase']; minutes: number } | null {
	if (tb.phase !== 'focus') return { phase: 'focus', minutes: tb.focus_minutes };
	if (tb.block_number >= tb.rounds) return null;
	const phase = tb.block_number % TB_LONG_BREAK_EVERY === 0 ? 'long_break' : 'break';
	return { phase, minutes: tbMinutes(tb, phase) };
}

/**
 * One bar per focus block, filled 0–1: done blocks full, the running focus block
 * by how much of it has passed, the rest empty. During a break the block before
 * it is done.
 */
export function tbSegments(tb: TimeboxLike, nowMs: number): number[] {
	const out: number[] = [];
	const span = tb.focus_minutes * 60_000;
	for (let n = 1; n <= tb.rounds; n++) {
		if (n < tb.block_number) out.push(1);
		else if (n > tb.block_number) out.push(0);
		else if (tb.phase !== 'focus') out.push(1);
		else out.push(span > 0 ? Math.max(0, Math.min(1, 1 - tbLeft(tb, nowMs) / span)) : 0);
	}
	return out;
}
