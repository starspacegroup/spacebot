/**
 * What the Activity's Game tab may show a viewer, and the moves it may make.
 *
 * The Activity is where the game is played, so this is where its secrets live:
 * a player's own role, and the word if they are not the agent. Nothing else is
 * private to anyone, and nothing about another player's role is sent until the
 * round has ended. The viewer's signed session token says which servers they
 * may touch; nothing here is taken from the client but ids, and every move is
 * re-checked against the round and the live voice table.
 */

import { getCommandByName } from '../db/commands.js';
import {
	callCode,
	castVote,
	callVote,
	endRound,
	getPlayers,
	getRound,
	getVotes,
	isFail,
	joinRound,
	lastClosedMeeting,
	leaveRound,
	liveRoundForVoice,
	nameOf,
	openLobby,
	openMeeting,
	recentEndedForVoice,
	resolveDue,
	resultText,
	startRound,
	type CallCode,
	type Round,
} from './game.js';
import { voiceChannelOf } from './timebox.js';
import type { TokenClaims } from './activity.js';

export class GameAccessError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

const unix = (iso: string | null) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

async function authorize(db: any, claims: TokenClaims, guildId: unknown): Promise<string> {
	if (typeof guildId !== 'string' || !claims.g.includes(guildId)) {
		throw new GameAccessError(403, 'That server is not part of this session.');
	}
	if (!(await getCommandByName(db, 'play', guildId))) {
		throw new GameAccessError(403, 'Game is not turned on in this server.');
	}
	return guildId;
}

export interface GameView {
	/** The voice channel this view is about: the one the viewer is in, else the one the Activity opened in. */
	voice_channel_id: string | null;
	/** The viewer is in a voice channel with no live round, so they can open a lobby. */
	can_open: boolean;
	round: null | {
		id: number;
		status: Round['status'];
		agent_name: string;
		crew_name: string;
		min_players: number;
		calls_per_player: number;
		started_at: number | null;
		ends_at: number | null;
		call_unlocks_at: number | null;
		is_starter: boolean;
		players: { id: string; name: string; state: 'in' | 'ejected' }[];
		me: {
			in: boolean;
			state: 'in' | 'ejected' | null;
			role: 'agent' | 'crew' | null;
			/** Only for a player who is not the agent. */
			word: string | null;
			calls_left: number;
			call: CallCode;
		};
		meeting: null | {
			id: number;
			caller_id: string;
			closes_at: number;
			voted: number;
			living: number;
			my_vote: string | null;
		};
		last_vote: null | { ejected_id: string | null; ejected_name: string | null };
		/** Only once the round has ended. */
		result: null | {
			code: NonNullable<Round['result']>;
			text: string;
			agent_id: string | null;
			word: string | null;
			roles: {
				id: string;
				name: string;
				role: 'agent' | 'crew' | null;
				state: 'in' | 'ejected';
			}[];
		};
	};
}

export async function gameViewForViewer(
	db: any,
	discord: any,
	claims: TokenClaims,
	guildId: unknown,
	now = new Date()
): Promise<GameView> {
	const gid = await authorize(db, claims, guildId);
	const here = await voiceChannelOf(db, gid, claims.u);
	const channels = [here, claims.c].filter((c): c is string => Boolean(c));

	let round: Round | null = null;
	for (const ch of channels) {
		round = await liveRoundForVoice(db, gid, ch);
		if (round) break;
	}
	if (!round) {
		for (const ch of channels) {
			round = await recentEndedForVoice(db, gid, ch, now);
			if (round) break;
		}
	}
	if (round) round = (await resolveDue(db, discord, round, now)) ?? round;

	const voice = round?.voice_channel_id ?? channels[0] ?? null;
	const liveHere = here ? await liveRoundForVoice(db, gid, here) : null;
	const out: GameView = {
		voice_channel_id: voice,
		can_open: Boolean(here && !liveHere),
		round: null,
	};
	if (!round) return out;

	const players = await getPlayers(db, round.id);
	const mine = players.find((p) => p.user_id === claims.u) ?? null;
	const meeting = round.status === 'running' ? await openMeeting(db, round.id) : null;
	const ended = round.status === 'ended';
	const living = players.filter((p) => p.state === 'in');

	let meetingView: NonNullable<GameView['round']>['meeting'] = null;
	if (meeting) {
		const votes = await getVotes(db, meeting.id);
		meetingView = {
			id: meeting.id,
			caller_id: meeting.caller_id,
			closes_at: unix(meeting.closes_at)!,
			voted: votes.length,
			living: living.length,
			my_vote: votes.find((v) => v.voter_id === claims.u)?.target ?? null,
		};
	}

	let lastVote: NonNullable<GameView['round']>['last_vote'] = null;
	if (round.status !== 'lobby') {
		const closed = await lastClosedMeeting(db, round.id);
		if (closed) {
			lastVote = {
				ejected_id: closed.ejected_id,
				ejected_name: players.find((p) => p.user_id === closed.ejected_id)?.name ?? null,
			};
		}
	}

	const role = mine?.role ?? null;
	out.round = {
		id: round.id,
		status: round.status,
		agent_name: round.agent_name,
		crew_name: round.crew_name,
		min_players: round.min_players,
		calls_per_player: round.calls_per_player,
		started_at: unix(round.started_at),
		ends_at: unix(round.ends_at),
		call_unlocks_at: round.started_at
			? Math.floor(new Date(round.started_at).getTime() / 1000) + round.call_lock_seconds
			: null,
		is_starter: round.starter_id === claims.u,
		// Roles are not in this list: a name and whether they are still in.
		players: players.map((p) => ({ id: p.user_id, name: p.name, state: p.state })),
		me: {
			in: Boolean(mine),
			state: mine?.state ?? null,
			role: round.status === 'running' ? role : ended ? role : null,
			word:
				round.status === 'running' && role === 'crew'
					? round.word
					: ended
						? round.word
						: null,
			calls_left: mine ? Math.max(0, round.calls_per_player - mine.calls_used) : 0,
			call: callCode(round, mine, Boolean(meeting), now),
		},
		meeting: meetingView,
		last_vote: lastVote,
		result: ended
			? {
					code: round.result!,
					text: resultText(round),
					agent_id: round.agent_id,
					word: round.word,
					roles: players.map((p) => ({
						id: p.user_id,
						name: p.name,
						role: p.role,
						state: p.state,
					})),
				}
			: null,
	};
	return out;
}

export async function gameAct(
	db: any,
	discord: any,
	claims: TokenClaims,
	guildId: unknown,
	body: { action?: unknown; round_id?: unknown; target?: unknown },
	now = new Date()
): Promise<{ ok: true } | { error: string }> {
	const gid = await authorize(db, claims, guildId);
	const action = String(body.action || '');
	const roundId = Number(body.round_id);

	if (action === 'open') {
		const vc = await voiceChannelOf(db, gid, claims.u);
		if (!vc) return { error: 'Join a voice channel first.' };
		const out = await openLobby(
			db,
			discord,
			{
				guildId: gid,
				voiceChannelId: vc,
				starterId: claims.u,
				starterName: await nameOf(db, gid, claims.u),
			},
			now
		);
		return isFail(out) ? out : { ok: true };
	}

	// Everything else is about one round, and it must be this server's.
	const round = Number.isInteger(roundId) ? await getRound(db, roundId) : null;
	if (!round || round.guild_id !== gid) return { error: 'That round is gone.' };

	switch (action) {
		case 'join': {
			const out = await joinRound(
				db,
				discord,
				roundId,
				{ id: claims.u, name: await nameOf(db, gid, claims.u) },
				now
			);
			return isFail(out) ? out : { ok: true };
		}
		case 'leave': {
			const out = await leaveRound(db, discord, roundId, claims.u, now);
			return isFail(out) ? out : { ok: true };
		}
		case 'start': {
			const out = await startRound(db, discord, roundId, { by: claims.u }, now);
			return isFail(out) ? out : { ok: true };
		}
		case 'stop': {
			if (round.starter_id !== claims.u)
				return { error: 'Only the person who opened it can end the round.' };
			await endRound(db, discord, round, 'cancelled', now);
			return { ok: true };
		}
		case 'call': {
			const out = await callVote(db, discord, roundId, claims.u, now);
			return isFail(out) ? out : { ok: true };
		}
		case 'vote': {
			const out = await castVote(
				db,
				discord,
				roundId,
				claims.u,
				String(body.target || ''),
				now
			);
			return isFail(out) ? out : { ok: true };
		}
		default:
			return { error: 'Unknown move.' };
	}
}
