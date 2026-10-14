/**
 * What the Activity's Timebox tab may show a viewer.
 *
 * Read-only for now. The viewer's session token says which servers they may
 * touch; this answers only for those, only when the server has turned Timebox
 * on, and only with sessions the viewer is part of: their own solo timebox, the
 * shared one in the voice channel the Activity was opened in, and the shared one
 * in the voice channel they are in right now. Nothing here is taken from the
 * client but the server id, and that is checked against the signed token.
 */

import { getCommandByName } from '../db/commands.js';
import {
	getParticipant,
	liveForVoice,
	liveSoloFor,
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
