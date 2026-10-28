/**
 * What the Activity's Timebox tab may show a viewer.
 *
 * The viewer's session token says which servers they may
 * touch; this answers only for those, only when the server has turned Timebox
 * on, and only with sessions the viewer is part of: their own solo timebox, the
 * shared one in the voice channel the Activity was opened in, and the shared one
 * in the voice channel they are in right now. Nothing here is taken from the
 * client but the server id, and that is checked against the signed token.
 */

import { getCommandByName } from '../db/commands.js';
import {
	endSession,
	getParticipant,
	getSession,
	liveForVoice,
	liveSoloFor,
	pauseSession,
	resumeSession,
	skipBlock,
	voiceChannelOf,
	type DeafenMode,
	type Session,
} from './timebox.js';
import type { TokenClaims } from './activity.js';

export interface ActivityTimebox {
	id: number;
	kind: 'solo' | 'shared';
	status: Session['status'];
	phase: Session['phase'];
	block_number: number;
	rounds: number;
	focus_minutes: number;
	break_minutes: number;
	long_break_minutes: number;
	/** Unix seconds, or null while paused. */
	ends_at: number | null;
	paused_remaining_ms: number | null;
	voice_channel_id: string | null;
	mine: boolean;
	deafen: DeafenMode;
}

/** Someone else's timer, as the people sharing their voice channel see it. */
export interface ActivityTimeboxOther {
	name: string;
	avatar_url: string | null;
	status: Session['status'];
	phase: Session['phase'];
	block_number: number;
	rounds: number;
	focus_minutes: number;
	break_minutes: number;
	long_break_minutes: number;
	ends_at: number | null;
	paused_remaining_ms: number | null;
}

export class TimeboxAccessError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

function view(s: Session, userId: string, deafen: DeafenMode): ActivityTimebox {
	return {
		id: s.id,
		kind: s.kind,
		status: s.status,
		phase: s.phase,
		block_number: s.block_number,
		rounds: s.rounds,
		focus_minutes: s.focus_minutes,
		break_minutes: s.break_minutes,
		long_break_minutes: s.long_break_minutes,
		ends_at: s.phase_ends_at ? Math.floor(new Date(s.phase_ends_at).getTime() / 1000) : null,
		paused_remaining_ms: s.paused_remaining_ms,
		voice_channel_id: s.voice_channel_id,
		mine: s.starter_id === userId,
		deafen,
	};
}

export async function timeboxesForViewer(
	db: any,
	claims: TokenClaims,
	guildId: unknown
): Promise<ActivityTimebox[]> {
	if (typeof guildId !== 'string' || !claims.g.includes(guildId)) {
		throw new TimeboxAccessError(403, 'That server is not part of this session.');
	}
	if (!(await getCommandByName(db, 'timebox', guildId))) {
		throw new TimeboxAccessError(403, 'Timebox is not turned on in this server.');
	}

	const found = new Map<number, Session>();
	const solo = await liveSoloFor(db, guildId, claims.u);
	if (solo) found.set(solo.id, solo);

	const channels = new Set<string>();
	if (claims.c) channels.add(claims.c);
	const here = await voiceChannelOf(db, guildId, claims.u);
	if (here) channels.add(here);
	for (const channel of channels) {
		const shared = await liveForVoice(db, guildId, channel);
		if (shared) found.set(shared.id, shared);
	}

	const out: ActivityTimebox[] = [];
	for (const s of found.values()) {
		const mine = await getParticipant(db, s.id, claims.u);
		out.push(view(s, claims.u, mine?.deafen_mode ?? 'none'));
	}
	return out;
}

/**
 * The other members' solo timers, for the people in the same voice channel as the
 * viewer (or the one the Activity was opened in). Only a name, a face and the
 * countdown leave the server: no ids, no goals, no deafen choice. A shared timebox
 * is already listed in full, so it is not repeated here.
 */
export async function othersForViewer(
	db: any,
	claims: TokenClaims,
	guildId: string
): Promise<ActivityTimeboxOther[]> {
	const channels = new Set<string>();
	if (claims.c) channels.add(claims.c);
	const here = await voiceChannelOf(db, guildId, claims.u);
	if (here) channels.add(here);
	if (channels.size === 0) return [];
	const marks = [...channels].map(() => '?').join(',');
	const { results } = await db
		.prepare(
			`SELECT v.user_name, v.display_name, v.avatar_url, s.*
			 FROM live_voice_states v
			 JOIN timebox_sessions s ON s.guild_id = v.guild_id AND s.starter_id = v.user_id
			 WHERE v.guild_id = ? AND v.channel_id IN (${marks}) AND v.user_id != ?
			   AND s.kind = 'solo' AND s.status IN ('running', 'paused')
			 ORDER BY s.id LIMIT 25`
		)
		.bind(guildId, ...channels, claims.u)
		.all();
	return ((results || []) as any[]).map((r) => ({
		name: String(r.display_name || r.user_name || 'Someone'),
		avatar_url: r.avatar_url ?? null,
		status: r.status,
		phase: r.phase,
		block_number: r.block_number,
		rounds: r.rounds,
		focus_minutes: r.focus_minutes,
		break_minutes: r.break_minutes,
		long_break_minutes: r.long_break_minutes,
		ends_at: r.phase_ends_at ? Math.floor(new Date(r.phase_ends_at).getTime() / 1000) : null,
		paused_remaining_ms: r.paused_remaining_ms,
	}));
}

export type TimeboxAction = 'pause' | 'resume' | 'skip' | 'stop';

/**
 * Pause, resume, skip or stop one of the viewer's timeboxes from the Activity.
 * The same rule as the card's buttons, minus Crew (the Activity does not know the
 * viewer's server permissions): the starter, or anyone in the voice channel when the
 * server lets anyone control it. Crew still have the buttons on the card.
 */
export async function controlTimebox(
	db: any,
	discord: any,
	claims: TokenClaims,
	guildId: unknown,
	id: unknown,
	action: unknown
): Promise<ActivityTimebox | null> {
	if (typeof guildId !== 'string' || !claims.g.includes(guildId)) {
		throw new TimeboxAccessError(403, 'That server is not part of this session.');
	}
	if (!['pause', 'resume', 'skip', 'stop'].includes(String(action))) {
		throw new TimeboxAccessError(400, 'Unknown action.');
	}
	const s = typeof id === 'number' ? await getSession(db, id) : null;
	if (!s || s.guild_id !== guildId) throw new TimeboxAccessError(404, 'That timebox is gone.');
	if (s.status !== 'running' && s.status !== 'paused') {
		throw new TimeboxAccessError(409, 'That timebox has ended.');
	}
	const allowed =
		s.starter_id === claims.u ||
		(s.kind === 'shared' &&
			s.control === 'anyone' &&
			!!s.voice_channel_id &&
			(await voiceChannelOf(db, guildId, claims.u)) === s.voice_channel_id);
	if (!allowed) {
		throw new TimeboxAccessError(
			403,
			s.control === 'anyone'
				? 'Only someone in the voice channel or the starter can do that.'
				: 'Only the starter can do that here. Crew can use the card in the channel.'
		);
	}

	let fresh: Session;
	if (action === 'pause') fresh = await pauseSession(db, discord, s);
	else if (action === 'resume') fresh = await resumeSession(db, discord, s);
	else if (action === 'skip') fresh = await skipBlock(db, discord, s);
	else fresh = await endSession(db, discord, s, 'stopped');
	if (fresh.status !== 'running' && fresh.status !== 'paused') return null;
	const mine = await getParticipant(db, fresh.id, claims.u);
	return view(fresh, claims.u, mine?.deafen_mode ?? 'none');
}
