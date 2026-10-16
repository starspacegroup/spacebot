/**
 * Game — a hidden-agent round for everyone in a voice channel.
 *
 * A server opens a lobby for a voice channel (`/play start`, or the Activity),
 * players join, and the starter deals: everyone but one is told a secret word,
 * and one is the agent and is not. They talk in voice. After a short lock any
 * player may call a vote; every living player votes for who they think the agent
 * is, or skips. The most votes is ejected; a tie, or skip on top, ejects nobody.
 * Ejecting the agent ends the round for the players. If the clock runs out with
 * the agent still in, or only the agent and one other are left, the agent wins.
 *
 * The Activity is where it is played: the role, the word, the ballot and the
 * clock are all private to the viewer and live there. Discord only gets the
 * lobby card, a line when a vote is called, and the result. Nothing in a voice
 * channel's text chat can be a secret.
 *
 * The round is a state machine in D1, and every transition is a guarded UPDATE
 * (`WHERE status = ...`, checked by `meta.changes`) so two clicks cannot both
 * count. Nothing needs a sub-minute timer: a vote closes when the last living
 * player votes, and anything overdue (a vote past its deadline, a clock that ran
 * out) is resolved by whoever looks next — the Activity's next poll, a button,
 * or the minute sweep (`sweepGame`).
 *
 * Shared by the interactions route (command and buttons, on the edge), the
 * Activity API, and the cron route (the sweep): D1 and the REST client only.
 */

import { log } from '../log.js';
import { getCommandByName } from '../db/commands.js';
import { flattenInteractionOptions } from '../discord/interaction-options.js';
import { ADMINISTRATOR, parsePermissionBits } from '../discord/command-permissions.js';
import { pickWord } from './game-words.js';
import { humansInChannel, voiceChannelOf } from './timebox.js';

export const RESPOND_MESSAGE = 4; // CHANNEL_MESSAGE_WITH_SOURCE
export const RESPOND_UPDATE = 7; // UPDATE_MESSAGE
const EPHEMERAL = 64;

const MANAGE_GUILD = 1n << 5n;
const MANAGE_MESSAGES = 1n << 13n;

// --- settings -----------------------------------------------------------------

export const DEFAULTS = {
	agentName: 'Agent',
	crewName: 'Crew',
	minPlayers: 4,
	roundSeconds: 300,
	callLockSeconds: 60,
	meetingSeconds: 30,
	callsPerPlayer: 1,
	muteOut: true,
};

/** Bounds the dashboard enforces; `[min, max]`. */
export const LIMITS = {
	minPlayers: [3, 15],
	roundSeconds: [120, 1800],
	callLockSeconds: [0, 600],
	meetingSeconds: [15, 120],
	callsPerPlayer: [1, 5],
	name: [1, 20],
} as const;

/** A round never holds more than this many players. */
export const MAX_PLAYERS = 15;
/** A lobby nobody starts is closed after this long. */
export const LOBBY_TTL_MS = 30 * 60 * 1000;
/** A running round whose voice channel stays empty this long is ended. */
export const EMPTY_GRACE_MS = 3 * 60 * 1000;
/** The sweep stops retrying a mute it could not lift this long after the round ended. */
export const RESTORE_GIVE_UP_MS = 6 * 60 * 60 * 1000;
/** The Activity keeps showing a finished round's result for this long. */
export const RESULT_VISIBLE_MS = 10 * 60 * 1000;

export interface Settings {
	agentName: string;
	crewName: string;
	minPlayers: number;
	roundSeconds: number;
	callLockSeconds: number;
	meetingSeconds: number;
	callsPerPlayer: number;
	muteOut: boolean;
}

export async function getSettings(db, guildId: string): Promise<Settings> {
	const row: any = await db
		.prepare(`SELECT * FROM game_settings WHERE guild_id = ?`)
		.bind(guildId)
		.first();
	return {
		agentName: row?.agent_name || DEFAULTS.agentName,
		crewName: row?.crew_name || DEFAULTS.crewName,
		minPlayers: row?.min_players ?? DEFAULTS.minPlayers,
		roundSeconds: row?.round_seconds ?? DEFAULTS.roundSeconds,
		callLockSeconds: row?.call_lock_seconds ?? DEFAULTS.callLockSeconds,
		meetingSeconds: row?.meeting_seconds ?? DEFAULTS.meetingSeconds,
		callsPerPlayer: row?.calls_per_player ?? DEFAULTS.callsPerPlayer,
		muteOut:
			row?.mute_out === null || row?.mute_out === undefined
				? DEFAULTS.muteOut
				: row.mute_out === 1,
	};
}

export async function upsertSettings(db, guildId: string, s: Settings) {
	await db
		.prepare(
			`INSERT INTO game_settings (guild_id, agent_name, crew_name, min_players, round_seconds,
			   call_lock_seconds, meeting_seconds, calls_per_player, mute_out)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(guild_id) DO UPDATE SET
			   agent_name = excluded.agent_name, crew_name = excluded.crew_name,
			   min_players = excluded.min_players, round_seconds = excluded.round_seconds,
			   call_lock_seconds = excluded.call_lock_seconds, meeting_seconds = excluded.meeting_seconds,
			   calls_per_player = excluded.calls_per_player, mute_out = excluded.mute_out,
			   updated_at = datetime('now')`
		)
		.bind(
			guildId,
			s.agentName,
			s.crewName,
			s.minPlayers,
			s.roundSeconds,
			s.callLockSeconds,
			s.meetingSeconds,
			s.callsPerPlayer,
			s.muteOut ? 1 : 0
		)
		.run();
}

// --- rows ---------------------------------------------------------------------

export type RoundStatus = 'lobby' | 'running' | 'ended';
export type Result = 'players' | 'agent_time' | 'agent_parity' | 'cancelled' | 'abandoned';

export interface Round {
	id: number;
	guild_id: string;
	voice_channel_id: string;
	starter_id: string;
	status: RoundStatus;
	word: string | null;
	agent_id: string | null;
	agent_name: string;
	crew_name: string;
	min_players: number;
	round_seconds: number;
	call_lock_seconds: number;
	meeting_seconds: number;
	calls_per_player: number;
	mute_out: number;
	message_id: string | null;
	empty_since: string | null;
	created_at: string;
	started_at: string | null;
	ends_at: string | null;
	ended_at: string | null;
	result: Result | null;
}

export interface Player {
	round_id: number;
	user_id: string;
	name: string;
	role: 'agent' | 'crew' | null;
	state: 'in' | 'ejected';
	calls_used: number;
	muted: number;
	prev_mute: number;
	restore_pending: number;
}

export interface Meeting {
	id: number;
	round_id: number;
	caller_id: string;
	opened_at: string;
	closes_at: string;
	closed_at: string | null;
	ejected_id: string | null;
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const iso = (ms: number) => new Date(ms).toISOString();
const LIVE = `status IN ('lobby', 'running')`;

export async function getRound(db, id: number): Promise<Round | null> {
	return ((await db.prepare(`SELECT * FROM game_rounds WHERE id = ?`).bind(id).first()) ??
		null) as Round | null;
}

export async function liveRoundForVoice(db, guildId: string, voiceChannelId: string) {
	return ((await db
		.prepare(
			`SELECT * FROM game_rounds WHERE guild_id = ? AND voice_channel_id = ? AND ${LIVE} ORDER BY id DESC LIMIT 1`
		)
		.bind(guildId, voiceChannelId)
		.first()) ?? null) as Round | null;
}

/** The round that most recently ended in a voice channel, if it ended recently. */
export async function recentEndedForVoice(
	db,
	guildId: string,
	voiceChannelId: string,
	now = new Date()
) {
	const row = (await db
		.prepare(
			`SELECT * FROM game_rounds WHERE guild_id = ? AND voice_channel_id = ? AND status = 'ended'
			 ORDER BY id DESC LIMIT 1`
		)
		.bind(guildId, voiceChannelId)
		.first()) as Round | null;
	if (!row?.ended_at) return null;
	return now.getTime() - new Date(row.ended_at).getTime() <= RESULT_VISIBLE_MS ? row : null;
}

export async function getPlayers(db, roundId: number): Promise<Player[]> {
	const { results } = await db
		.prepare(`SELECT * FROM game_players WHERE round_id = ? ORDER BY joined_at, user_id`)
		.bind(roundId)
		.all();
	return (results || []) as Player[];
}

export async function getPlayer(db, roundId: number, userId: string) {
	return ((await db
		.prepare(`SELECT * FROM game_players WHERE round_id = ? AND user_id = ?`)
		.bind(roundId, userId)
		.first()) ?? null) as Player | null;
}

export async function openMeeting(db, roundId: number): Promise<Meeting | null> {
	return ((await db
		.prepare(`SELECT * FROM game_meetings WHERE round_id = ? AND closed_at IS NULL`)
		.bind(roundId)
		.first()) ?? null) as Meeting | null;
}

export async function lastClosedMeeting(db, roundId: number): Promise<Meeting | null> {
	return ((await db
		.prepare(
			`SELECT * FROM game_meetings WHERE round_id = ? AND closed_at IS NOT NULL ORDER BY id DESC LIMIT 1`
		)
		.bind(roundId)
		.first()) ?? null) as Meeting | null;
}

export async function getVotes(db, meetingId: number) {
	const { results } = await db
		.prepare(`SELECT voter_id, target FROM game_votes WHERE meeting_id = ?`)
		.bind(meetingId)
		.all();
	return (results || []) as { voter_id: string; target: string }[];
}

/** A voice-channel member's display name from the gateway's live table. */
export async function nameOf(db, guildId: string, userId: string): Promise<string> {
	const row: any = await db
		.prepare(
			`SELECT display_name, user_name FROM live_voice_states WHERE guild_id = ? AND user_id = ?`
		)
		.bind(guildId, userId)
		.first();
	return String(row?.display_name || row?.user_name || 'Player').slice(0, 40);
}

// --- rules --------------------------------------------------------------------

export interface TallyResult {
	/** The ejected player's id, or null when nobody is. */
	ejected: string | null;
	counts: Record<string, number>;
	votes: number;
}

/**
 * The most votes is ejected. A tie for the most, or Skip on top, ejects nobody:
 * the Among Us rule, and the cheapest one to explain.
 */
export function tally(votes: { target: string }[]): TallyResult {
	const counts: Record<string, number> = {};
	for (const v of votes) counts[v.target] = (counts[v.target] ?? 0) + 1;
	const top = Math.max(0, ...Object.values(counts));
	const leaders = Object.keys(counts).filter((k) => counts[k] === top);
	const ejected = top > 0 && leaders.length === 1 && leaders[0] !== 'skip' ? leaders[0] : null;
	return { ejected, counts, votes: votes.length };
}

/**
 * Whether the round is over, and how. Order matters: catching the agent beats
 * everything, and the agent wins when only they and one other remain, because
 * one player cannot outvote them.
 */
export function checkEnd(
	round: Pick<Round, 'ends_at' | 'agent_id'>,
	players: Pick<Player, 'user_id' | 'state'>[],
	now: Date
): Result | null {
	const living = players.filter((p) => p.state === 'in');
	if (!living.some((p) => p.user_id === round.agent_id)) return 'players';
	if (living.length <= 2) return 'agent_parity';
	if (round.ends_at && new Date(round.ends_at) <= now) return 'agent_time';
	return null;
}

export type CallCode = 'ok' | 'no_round' | 'not_in' | 'out' | 'open' | 'locked' | 'used';

/** Whether a player may call a vote right now, as a code the Activity can show its own way. */
export function callCode(
	round: Round,
	player: Player | null,
	hasOpenMeeting: boolean,
	now: Date
): CallCode {
	if (round.status !== 'running') return 'no_round';
	if (!player) return 'not_in';
	if (player.state !== 'in') return 'out';
	if (hasOpenMeeting) return 'open';
	const unlocks = new Date(round.started_at!).getTime() + round.call_lock_seconds * 1000;
	if (now.getTime() < unlocks) return 'locked';
	if (player.calls_used >= round.calls_per_player) return 'used';
	return 'ok';
}

/** The same, as a sentence for Discord. */
export function callBlock(
	round: Round,
	player: Player | null,
	hasOpenMeeting: boolean,
	now: Date
): string | null {
	switch (callCode(round, player, hasOpenMeeting, now)) {
		case 'ok':
			return null;
		case 'no_round':
			return 'There is no round running.';
		case 'not_in':
			return 'You are not in this round.';
		case 'out':
			return 'You have been ejected.';
		case 'open':
			return 'A vote is already open.';
		case 'locked': {
			const unlocks = new Date(round.started_at!).getTime() + round.call_lock_seconds * 1000;
			return `Votes unlock <t:${Math.ceil(unlocks / 1000)}:R>. Talk first.`;
		}
		default:
			return 'You have used your call.';
	}
}

export function resultText(round: Round): string {
	switch (round.result) {
		case 'players':
			return `The ${round.crew_name} win: the ${round.agent_name} was ejected.`;
		case 'agent_time':
			return `The ${round.agent_name} wins: time ran out with them still in.`;
		case 'agent_parity':
			return `The ${round.agent_name} wins: only they and one other were left.`;
		case 'abandoned':
			return 'The round ended: the voice channel emptied.';
		default:
			return 'The round was cancelled.';
	}
}

// --- lobby --------------------------------------------------------------------

export type Fail = { error: string };
const fail = (error: string): Fail => ({ error });
export const isFail = (v: unknown): v is Fail =>
	Boolean(v && typeof v === 'object' && 'error' in v);

export async function openLobby(
	db,
	discord,
	ctx: { guildId: string; voiceChannelId: string; starterId: string; starterName: string },
	now = new Date()
): Promise<Round | Fail> {
	const s = await getSettings(db, ctx.guildId);
	let id: number;
	try {
		id = await db
			.prepare(
				`INSERT INTO game_rounds (guild_id, voice_channel_id, starter_id, agent_name, crew_name,
				   min_players, round_seconds, call_lock_seconds, meeting_seconds, calls_per_player, mute_out, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
			)
			.bind(
				ctx.guildId,
				ctx.voiceChannelId,
				ctx.starterId,
				s.agentName,
				s.crewName,
				s.minPlayers,
				s.roundSeconds,
				s.callLockSeconds,
				s.meetingSeconds,
				s.callsPerPlayer,
				s.muteOut ? 1 : 0,
				now.toISOString()
			)
			.first()
			.then((r: any) => r?.id as number);
	} catch (err: any) {
		if (/UNIQUE/i.test(String(err?.message))) {
			return fail('There is already a round in this voice channel.');
		}
		throw err;
	}
	await db
		.prepare(
			`INSERT INTO game_players (round_id, user_id, name, joined_at) VALUES (?, ?, ?, ?)`
		)
		.bind(id, ctx.starterId, ctx.starterName, now.toISOString())
		.run();

	const round = (await getRound(db, id)) as Round;
	if (discord) {
		try {
			const msg = await discord.channels.send(
				round.voice_channel_id,
				await lobbyMessage(db, round)
			);
			if (msg?.id) {
				await db
					.prepare(`UPDATE game_rounds SET message_id = ? WHERE id = ?`)
					.bind(msg.id, id)
					.run();
				round.message_id = msg.id;
			}
		} catch (err: any) {
			// The Activity still works without the card; say why in the log.
			log.warn(`[Game] Could not post the lobby card for #${id}: ${err?.message}`);
		}
	}
	return round;
}

export async function joinRound(
	db,
	discord,
	roundId: number,
	user: { id: string; name: string },
	now = new Date()
): Promise<Round | Fail> {
	const round = await getRound(db, roundId);
	if (!round || round.status !== 'lobby') return fail('That lobby is closed.');
	if ((await voiceChannelOf(db, round.guild_id, user.id)) !== round.voice_channel_id) {
		return fail('Join the voice channel this round is in first.');
	}
	const players = await getPlayers(db, roundId);
	if (players.some((p) => p.user_id === user.id)) return round;
	if (players.length >= MAX_PLAYERS) return fail(`A round holds ${MAX_PLAYERS} players.`);
	await db
		.prepare(
			`INSERT OR IGNORE INTO game_players (round_id, user_id, name, joined_at) VALUES (?, ?, ?, ?)`
		)
		.bind(roundId, user.id, user.name, now.toISOString())
		.run();
	await refreshCard(db, discord, round);
	return round;
}

export async function leaveRound(db, discord, roundId: number, userId: string, now = new Date()) {
	const round = await getRound(db, roundId);
	if (!round || round.status !== 'lobby') return fail('You can only leave a lobby.');
	await db
		.prepare(`DELETE FROM game_players WHERE round_id = ? AND user_id = ?`)
		.bind(roundId, userId)
		.run();
	if ((await getPlayers(db, roundId)).length === 0) {
		await endRound(db, discord, round, 'cancelled', now);
		return (await getRound(db, roundId)) as Round;
	}
	await refreshCard(db, discord, round);
	return round;
}

// --- the deal -----------------------------------------------------------------

/** A uniform pick in [0, n) from the platform's random source. */
function randomIndex(n: number, rng?: () => number): number {
	if (rng) return Math.floor(rng() * n);
	const buf = new Uint32Array(1);
	// Rejection sampling, so a small player count is not biased by the modulo.
	const limit = Math.floor(0x100000000 / n) * n;
	do crypto.getRandomValues(buf);
	while (buf[0] >= limit);
	return buf[0] % n;
}

export async function startRound(
	db,
	discord,
	roundId: number,
	opts: { by: string; byCrew?: boolean; rng?: () => number },
	now = new Date()
): Promise<Round | Fail> {
	const round = await getRound(db, roundId);
	if (!round || round.status !== 'lobby') return fail('That lobby is closed.');
	if (round.starter_id !== opts.by && !opts.byCrew) {
		return fail('Only the person who opened the lobby, or Crew, can start the round.');
	}

	// Someone who left the voice channel since joining is not playing.
	const here = new Set(await humansInChannel(db, round.guild_id, round.voice_channel_id));
	const players = (await getPlayers(db, roundId)).filter((p) => here.has(p.user_id));
	if (players.length < round.min_players) {
		return fail(
			`Needs ${round.min_players} players in the voice channel to start (${players.length} so far).`
		);
	}

	const agent = players[randomIndex(players.length, opts.rng)];
	const word = pickWord(opts.rng);
	const endsAt = iso(now.getTime() + round.round_seconds * 1000);

	// The guard that makes two simultaneous starts deal once.
	const res = await db
		.prepare(
			`UPDATE game_rounds SET status = 'running', word = ?, agent_id = ?, started_at = ?, ends_at = ?
			 WHERE id = ? AND status = 'lobby'`
		)
		.bind(word, agent.user_id, now.toISOString(), endsAt, roundId)
		.run();
	if (res?.meta && res.meta.changes === 0) return fail('That round already started.');

	const stay = new Set(players.map((p) => p.user_id));
	for (const p of await getPlayers(db, roundId)) {
		if (!stay.has(p.user_id)) {
			await db
				.prepare(`DELETE FROM game_players WHERE round_id = ? AND user_id = ?`)
				.bind(roundId, p.user_id)
				.run();
			continue;
		}
		await db
			.prepare(`UPDATE game_players SET role = ? WHERE round_id = ? AND user_id = ?`)
			.bind(p.user_id === agent.user_id ? 'agent' : 'crew', roundId, p.user_id)
			.run();
	}

	const fresh = (await getRound(db, roundId)) as Round;
	if (discord) {
		await refreshCard(db, discord, fresh);
		await post(discord, fresh, {
			content: `Round started. ${[...stay].map((id) => `<@${id}>`).join(' ')} Open the **SpaceBot Activity** in this voice channel to see your role. Talk it out: votes unlock <t:${unix(now.toISOString()) + fresh.call_lock_seconds}:R>, and the round ends <t:${unix(endsAt)}:R>.`,
			allowed_mentions: { users: [...stay] },
		});
	}
	return fresh;
}

// --- calling and casting votes --------------------------------------------------

export async function callVote(
	db,
	discord,
	roundId: number,
	userId: string,
	now = new Date()
): Promise<Meeting | Fail> {
	let round = await getRound(db, roundId);
	if (!round) return fail('That round is gone.');
	round = (await resolveDue(db, discord, round, now)) ?? round;
	const player = await getPlayer(db, roundId, userId);
	const open = await openMeeting(db, roundId);
	const block = callBlock(round, player, Boolean(open), now);
	if (block) return fail(block);

	// Spend the call first: the guard is the update, so two taps spend one call.
	const spent = await db
		.prepare(
			`UPDATE game_players SET calls_used = calls_used + 1
			 WHERE round_id = ? AND user_id = ? AND calls_used < ?`
		)
		.bind(roundId, userId, round.calls_per_player)
		.run();
	if (spent?.meta && spent.meta.changes === 0) return fail('You have used your call.');

	const closesAt = iso(now.getTime() + round.meeting_seconds * 1000);
	try {
		await db
			.prepare(
				`INSERT INTO game_meetings (round_id, caller_id, opened_at, closes_at) VALUES (?, ?, ?, ?) RETURNING id`
			)
			.bind(roundId, userId, now.toISOString(), closesAt)
			.first()
			.then((r: any) => r?.id as number);
	} catch (err: any) {
		// Someone else opened one in the same instant; give the call back.
		await db
			.prepare(
				`UPDATE game_players SET calls_used = calls_used - 1 WHERE round_id = ? AND user_id = ?`
			)
			.bind(roundId, userId)
			.run();
		if (/UNIQUE/i.test(String(err?.message))) return fail('A vote is already open.');
		throw err;
	}

	if (discord) {
		await post(discord, round, {
			content: `<@${userId}> called a vote. Open the **SpaceBot Activity** and pick who you think the ${round.agent_name} is, or skip. It closes <t:${unix(closesAt)}:R>.`,
			allowed_mentions: { users: [userId] },
		});
	}
	return (await openMeeting(db, roundId)) as Meeting;
}

export async function castVote(
	db,
	discord,
	roundId: number,
	userId: string,
	target: string,
	now = new Date()
): Promise<{ ok: true; closed: boolean } | Fail> {
	let round = await getRound(db, roundId);
	if (!round) return fail('That round is gone.');
	round = (await resolveDue(db, discord, round, now)) ?? round;
	const meeting = await openMeeting(db, roundId);
	if (round.status !== 'running' || !meeting) return fail('There is no vote open.');

	const voter = await getPlayer(db, roundId, userId);
	if (!voter || voter.state !== 'in') return fail('Only players still in the round can vote.');
	if (target !== 'skip') {
		if (target === userId) return fail('You cannot vote for yourself.');
		const t = await getPlayer(db, roundId, target);
		if (!t || t.state !== 'in') return fail('Pick a player who is still in.');
	}

	await db
		.prepare(
			`INSERT INTO game_votes (meeting_id, voter_id, target) VALUES (?, ?, ?)
			 ON CONFLICT(meeting_id, voter_id) DO UPDATE SET target = excluded.target`
		)
		.bind(meeting.id, userId, target)
		.run();

	// Everyone living has voted: no reason to wait out the clock.
	const living = (await getPlayers(db, roundId)).filter((p) => p.state === 'in').length;
	const votes = await getVotes(db, meeting.id);
	if (votes.length >= living) {
		await closeMeeting(db, discord, round, meeting, now);
		return { ok: true, closed: true };
	}
	return { ok: true, closed: false };
}

/**
 * Close a meeting: count, eject, and see whether that ended the round. The
 * claim is a guarded update, so the last vote and the deadline cannot both do it.
 */
export async function closeMeeting(db, discord, round: Round, meeting: Meeting, now = new Date()) {
	const claimed = await db
		.prepare(`UPDATE game_meetings SET closed_at = ? WHERE id = ? AND closed_at IS NULL`)
		.bind(now.toISOString(), meeting.id)
		.run();
	if (claimed?.meta && claimed.meta.changes === 0) return;

	// Only living players' votes count; one ejected since voting cannot happen,
	// but a vote for a player who is no longer in cannot eject them twice.
	const players = await getPlayers(db, round.id);
	const living = new Set(players.filter((p) => p.state === 'in').map((p) => p.user_id));
	const votes = (await getVotes(db, meeting.id)).filter((v) => living.has(v.voter_id));
	const { ejected } = tally(votes);

	let line: string;
	if (ejected) {
		await db
			.prepare(
				`UPDATE game_players SET state = 'ejected', ejected_at = ? WHERE round_id = ? AND user_id = ? AND state = 'in'`
			)
			.bind(now.toISOString(), round.id, ejected)
			.run();
		await db
			.prepare(`UPDATE game_meetings SET ejected_id = ? WHERE id = ?`)
			.bind(ejected, meeting.id)
			.run();
		if (round.mute_out) await applyMute(db, discord, round, ejected);
		line =
			ejected === round.agent_id
				? `The table ejected <@${ejected}> — they were the **${round.agent_name}**.`
				: `The table ejected <@${ejected}> — they were **not** the ${round.agent_name}. The round goes on.`;
	} else {
		line = 'The vote ended with nobody ejected (a tie, or skip on top). The round goes on.';
	}

	const after = await getPlayers(db, round.id);
	const result = checkEnd(round, after, now);
	if (discord) await post(discord, round, { content: line, allowed_mentions: { users: [] } });
	if (result) await endRound(db, discord, round, result, now);
}

// --- ending -------------------------------------------------------------------

export async function endRound(db, discord, round: Round, result: Result, now = new Date()) {
	// Guarded: whoever gets here first ends it, once.
	const ended = await db
		.prepare(
			`UPDATE game_rounds SET status = 'ended', result = ?, ended_at = ? WHERE id = ? AND status != 'ended'`
		)
		.bind(result, now.toISOString(), round.id)
		.run();
	if (ended?.meta && ended.meta.changes === 0) return null;

	await db
		.prepare(`UPDATE game_meetings SET closed_at = ? WHERE round_id = ? AND closed_at IS NULL`)
		.bind(now.toISOString(), round.id)
		.run();

	const fresh = (await getRound(db, round.id)) as Round;
	for (const p of await getPlayers(db, round.id)) {
		if (p.muted) await restoreMute(db, discord, fresh, p);
	}

	if (discord) {
		await refreshCard(db, discord, fresh);
		if (result !== 'cancelled') {
			const reveal = fresh.agent_id
				? ` The ${fresh.agent_name} was <@${fresh.agent_id}>. The word was **${fresh.word}**.`
				: '';
			await post(discord, fresh, {
				content: `${resultText(fresh)}${reveal}`,
				allowed_mentions: { users: [] },
			});
		}
	}
	return fresh;
}

/** Resolve whatever is overdue on a round. Returns the round as it now stands. */
export async function resolveDue(
	db,
	discord,
	round: Round,
	now = new Date()
): Promise<Round | null> {
	if (round.status !== 'running') return round;
	const meeting = await openMeeting(db, round.id);
	if (meeting && new Date(meeting.closes_at) <= now) {
		await closeMeeting(db, discord, round, meeting, now);
	}
	let fresh = (await getRound(db, round.id)) as Round;
	if (fresh.status === 'running' && !(await openMeeting(db, round.id))) {
		const result = checkEnd(fresh, await getPlayers(db, round.id), now);
		if (result) {
			await endRound(db, discord, fresh, result, now);
			fresh = (await getRound(db, round.id)) as Round;
		}
	}
	return fresh;
}

// --- mutes --------------------------------------------------------------------

type MuteOutcome = 'applied' | 'not_in_voice' | 'no_permission' | 'error';

/**
 * Server-mute an ejected player, remembering what their mute was before. Only
 * someone in a voice channel can be changed; the sweep tries again for the rest.
 * Muted, never deafened: the ejected player still hears the argument.
 */
export async function applyMute(db, discord, round: Round, userId: string): Promise<MuteOutcome> {
	const player = await getPlayer(db, round.id, userId);
	if (!player || player.muted) return 'applied';
	const live: any = await db
		.prepare(
			`SELECT channel_id, server_mute FROM live_voice_states WHERE guild_id = ? AND user_id = ?`
		)
		.bind(round.guild_id, userId)
		.first();
	if (!live?.channel_id) return 'not_in_voice';
	const prev = live.server_mute ? 1 : 0;
	try {
		if (!prev && discord) {
			await discord.members.setMute(
				round.guild_id,
				userId,
				true,
				'Game: ejected from the round'
			);
		}
		await db
			.prepare(
				`UPDATE game_players SET muted = 1, prev_mute = ?, restore_pending = 0 WHERE round_id = ? AND user_id = ?`
			)
			.bind(prev, round.id, userId)
			.run();
		return 'applied';
	} catch (err: any) {
		if (err?.status === 403) return 'no_permission';
		if (err?.status === 400) return 'not_in_voice';
		log.warn(`[Game] Could not mute ${userId}: ${err?.message}`);
		return 'error';
	}
}

/**
 * Put back exactly the mute the player had before: one a moderator set stays.
 * When Discord will not change them (not in voice) the row stays pending and the
 * sweep retries.
 */
export async function restoreMute(db, discord, round: Round, player: Player): Promise<boolean> {
	const done = () =>
		db
			.prepare(
				`UPDATE game_players SET muted = 0, restore_pending = 0 WHERE round_id = ? AND user_id = ?`
			)
			.bind(round.id, player.user_id)
			.run();
	if (!player.muted) return true;
	if (player.prev_mute || !discord) {
		await done();
		return true;
	}
	try {
		await discord.members.setMute(round.guild_id, player.user_id, false, 'Game: round over');
		await done();
		return true;
	} catch (err: any) {
		if (err?.status === 404) {
			await done(); // left the server
			return true;
		}
		await db
			.prepare(
				`UPDATE game_players SET restore_pending = 1 WHERE round_id = ? AND user_id = ?`
			)
			.bind(round.id, player.user_id)
			.run();
		return false;
	}
}

// --- the cards ----------------------------------------------------------------

async function post(discord, round: Round, message: Record<string, any>) {
	try {
		await discord.channels.send(round.voice_channel_id, message);
	} catch (err: any) {
		log.warn(`[Game] Could not post in round #${round.id}: ${err?.message}`);
	}
}

export async function lobbyMessage(db, round: Round) {
	const players = await getPlayers(db, round.id);
	const names = players.map((p) => `<@${p.user_id}>`).join(', ') || '_nobody yet_';
	let content: string;
	let components: any[] = [];
	if (round.status === 'lobby') {
		content = `**Hidden ${round.agent_name} — lobby**\nPlayers (${players.length}): ${names}\nNeeds ${round.min_players} to start. Everyone but one is told a secret word; one is the ${round.agent_name} and is not. Play it in the **SpaceBot Activity** in this voice channel: your role, the word and the voting are there.`;
		components = [
			{
				type: 1,
				components: [
					{ type: 2, style: 3, label: 'Join', custom_id: `game:join:${round.id}` },
					{ type: 2, style: 2, label: 'Leave', custom_id: `game:leave:${round.id}` },
					{ type: 2, style: 1, label: 'Start', custom_id: `game:start:${round.id}` },
					{ type: 2, style: 4, label: 'Cancel', custom_id: `game:stop:${round.id}` },
				],
			},
		];
	} else if (round.status === 'running') {
		content = `**Hidden ${round.agent_name} — round running**\nPlayers (${players.length}): ${names}\nEnds <t:${unix(round.ends_at!)}:R>. Open the **SpaceBot Activity** to see your role and to vote.`;
	} else {
		content = `**Hidden ${round.agent_name} — over**\n${resultText(round)}`;
	}
	return { content, components, allowed_mentions: { parse: [] } };
}

async function refreshCard(db, discord, round: Round) {
	if (!discord || !round.message_id) return;
	try {
		const fresh = (await getRound(db, round.id)) as Round;
		await discord.channels.editMessage(
			fresh.voice_channel_id,
			round.message_id,
			await lobbyMessage(db, fresh)
		);
	} catch (err: any) {
		log.warn(`[Game] Could not edit the card for #${round.id}: ${err?.message}`);
	}
}

// --- the sweep ----------------------------------------------------------------

/**
 * The minute sweep: resolve overdue rounds, close lobbies nobody started, end a
 * round whose voice channel emptied, apply a mute that had to wait for someone
 * to be in voice, and retry lifts Discord refused. The reaper: nothing this game
 * did to a member outlives the round that did it.
 */
export async function sweepGame(db, botTokenOrClient, now = new Date()) {
	const summary = {
		resolved: 0,
		lobbies_closed: 0,
		abandoned: 0,
		muted: 0,
		restored: 0,
		restore_failed: 0,
	};
	if (!db) return { ...summary, error: 'Database not available' };

	const { results: live } = await db.prepare(`SELECT * FROM game_rounds WHERE ${LIVE}`).all();
	const { results: pending } = await db
		.prepare(
			`SELECT p.*, r.guild_id AS guild_id, r.ended_at AS ended_at FROM game_players p
			 JOIN game_rounds r ON r.id = p.round_id WHERE p.restore_pending = 1`
		)
		.all();
	if (!live?.length && !pending?.length) return summary;

	const discord =
		typeof botTokenOrClient === 'string'
			? (await import('../discord/rest-client.js')).createDiscordRestClient(botTokenOrClient)
			: botTokenOrClient;

	for (const r of (live || []) as Round[]) {
		try {
			if (r.status === 'lobby') {
				if (now.getTime() - new Date(r.created_at).getTime() > LOBBY_TTL_MS) {
					await endRound(db, discord, r, 'cancelled', now);
					summary.lobbies_closed++;
				}
				continue;
			}

			const here = await humansInChannel(db, r.guild_id, r.voice_channel_id);
			if (here.length === 0) {
				if (!r.empty_since) {
					await db
						.prepare(`UPDATE game_rounds SET empty_since = ? WHERE id = ?`)
						.bind(now.toISOString(), r.id)
						.run();
					r.empty_since = now.toISOString();
				} else if (now.getTime() - new Date(r.empty_since).getTime() >= EMPTY_GRACE_MS) {
					await endRound(db, discord, r, 'abandoned', now);
					summary.abandoned++;
					continue;
				}
			} else if (r.empty_since) {
				await db
					.prepare(`UPDATE game_rounds SET empty_since = NULL WHERE id = ?`)
					.bind(r.id)
					.run();
			}

			const before = r.status;
			const fresh = await resolveDue(db, discord, r, now);
			if (fresh && fresh.status !== before) {
				summary.resolved++;
				continue;
			}

			// An ejected player who was not in voice when ejected: mute them now.
			if (r.mute_out) {
				for (const p of await getPlayers(db, r.id)) {
					if (
						p.state === 'ejected' &&
						!p.muted &&
						(await applyMute(db, discord, r, p.user_id)) === 'applied'
					) {
						summary.muted++;
					}
				}
			}
		} catch (err: any) {
			log.error(`[Game] Sweep failed on round ${r.id}:`, err?.message || err);
		}
	}

	for (const p of (pending || []) as any[]) {
		const tooLong =
			p.ended_at && now.getTime() - new Date(p.ended_at).getTime() > RESTORE_GIVE_UP_MS;
		if (tooLong) {
			await db
				.prepare(
					`UPDATE game_players SET muted = 0, restore_pending = 0 WHERE round_id = ? AND user_id = ?`
				)
				.bind(p.round_id, p.user_id)
				.run();
			summary.restore_failed++;
			continue;
		}
		const round = (await getRound(db, p.round_id)) as Round;
		if (await restoreMute(db, discord, round, p)) summary.restored++;
	}
	return summary;
}

// --- the command and its buttons ------------------------------------------------

type Interaction = Record<string, any>;

export interface GameReply {
	response: Record<string, any>;
}

const ephemeral = (content: string) => ({
	type: RESPOND_MESSAGE,
	data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

/** Crew: Manage Server, Manage Messages or Administrator. */
export function isCrew(permissions: unknown): boolean {
	const bits = parsePermissionBits(permissions);
	if (bits === null) return false;
	return (
		(bits & ADMINISTRATOR) === ADMINISTRATOR ||
		(bits & MANAGE_GUILD) === MANAGE_GUILD ||
		(bits & MANAGE_MESSAGES) === MANAGE_MESSAGES
	);
}

function userOf(body: Interaction) {
	const u = body.member?.user || body.user;
	return {
		id: u?.id as string | undefined,
		name: String(body.member?.nick || u?.global_name || u?.username || 'Player').slice(0, 40),
	};
}

export async function handleGameCommand(body: Interaction, db, discord): Promise<GameReply> {
	const guildId = body.guild_id;
	const user = userOf(body);
	if (!guildId || !user.id) return { response: ephemeral('Game only works inside a server.') };
	if (!db) return { response: ephemeral('The database is not available right now.') };
	if (!(await getCommandByName(db, 'play', guildId))) {
		return { response: ephemeral('Game is not turned on in this server.') };
	}

	const { subcommand } = flattenInteractionOptions(body.data);
	const vc = await voiceChannelOf(db, guildId, user.id);

	switch (subcommand) {
		case 'start': {
			if (!vc)
				return { response: ephemeral('Join a voice channel first, then run /play start.') };
			const opened = await openLobby(db, discord, {
				guildId,
				voiceChannelId: vc,
				starterId: user.id,
				starterName: user.name,
			});
			if (isFail(opened)) return { response: ephemeral(opened.error) };
			return {
				response: ephemeral(
					`Lobby opened in <#${vc}>. Others join with the button or in the Activity.`
				),
			};
		}
		case 'stop': {
			const round = vc ? await liveRoundForVoice(db, guildId, vc) : null;
			if (!round)
				return { response: ephemeral('No round is running in your voice channel.') };
			if (round.starter_id !== user.id && !isCrew(body.member?.permissions)) {
				return { response: ephemeral('Only the starter or Crew can end the round.') };
			}
			await endRound(db, discord, round, 'cancelled');
			return { response: ephemeral('Round ended. Any mute it held is lifted.') };
		}
		case 'status': {
			const round = vc ? await liveRoundForVoice(db, guildId, vc) : null;
			if (!round)
				return { response: ephemeral('No round is running in your voice channel.') };
			const msg = await lobbyMessage(db, round);
			return { response: { type: RESPOND_MESSAGE, data: { ...msg, flags: EPHEMERAL } } };
		}
		default:
			return { response: ephemeral('Unknown subcommand.') };
	}
}

export async function handleGameComponent(body: Interaction, db, discord): Promise<GameReply> {
	const [, action, idText] = String(body.data?.custom_id || '').split(':');
	const id = Number(idText);
	const user = userOf(body);
	if (!db || !Number.isInteger(id) || !user.id) {
		return { response: ephemeral('That button has expired.') };
	}
	let round = await getRound(db, id);
	if (!round) return { response: ephemeral('That round is gone.') };
	if (round.status !== 'lobby') return { response: ephemeral('That lobby is closed.') };

	const card = async () => ({
		type: RESPOND_UPDATE,
		data: await lobbyMessage(db, (await getRound(db, id)) as Round),
	});

	if (action === 'join') {
		const out = await joinRound(db, discord, id, { id: user.id, name: user.name });
		return isFail(out) ? { response: ephemeral(out.error) } : { response: await card() };
	}
	if (action === 'leave') {
		const out = await leaveRound(db, discord, id, user.id);
		return isFail(out) ? { response: ephemeral(out.error) } : { response: await card() };
	}
	if (action === 'start') {
		const out = await startRound(db, discord, id, {
			by: user.id,
			byCrew: isCrew(body.member?.permissions),
		});
		return isFail(out) ? { response: ephemeral(out.error) } : { response: await card() };
	}
	if (action === 'stop') {
		if (round.starter_id !== user.id && !isCrew(body.member?.permissions)) {
			return { response: ephemeral('Only the starter or Crew can cancel the lobby.') };
		}
		round = (await endRound(db, discord, round, 'cancelled')) ?? round;
		return { response: await card() };
	}
	return { response: ephemeral('Unknown button.') };
}
