/**
 * Timebox — focus and break timers, alone or for a whole voice channel.
 *
 * `/timebox start` runs focus blocks and breaks: 23 minutes of focus, a 5-minute
 * break, and a 15-minute break after every fourth block, all changeable per
 * command and per server. Used while the member is in a voice channel it is
 * *shared*: one card for the channel, everyone in it pinged at each change. Used
 * outside voice, or with `solo`, it is the member's own.
 *
 * The countdown on a card is Discord's `<t:unix:R>`, which every client renders
 * live, so nothing edits a card per second. The minute sweep (`sweepTimebox`)
 * moves a session to its next block once its end time has passed, so a change can
 * land up to a minute late. That is the cost of using the same minute tick as
 * the room reaper instead of a timer in the gateway; see docs/timebox.md.
 *
 * "Deafen me" is a member's own choice for themselves. The bot records what their
 * server-deafen was before it touched it and puts exactly that back, so a member
 * a moderator had already deafened stays deafened. A member cannot lift their own
 * server-deafen in Discord, so the card's button always can, and so can the sweep.
 *
 * Shared by the interactions route (command and buttons, on the edge) and the
 * cron route (the sweep): D1 and the REST client only, nothing from discord.js.
 */

import { openActivityButton } from '$lib/discord/activity-button.js';
import { log } from '../log.js';
import { flattenInteractionOptions } from '../discord/interaction-options.js';
import { ADMINISTRATOR, parsePermissionBits } from '../discord/command-permissions.js';
import { getCommandByName } from '../db/commands.js';

export const RESPOND_MESSAGE = 4; // CHANNEL_MESSAGE_WITH_SOURCE
export const RESPOND_UPDATE = 7; // UPDATE_MESSAGE
const EPHEMERAL = 64;

const MANAGE_CHANNELS = 1n << 4n;
const MANAGE_GUILD = 1n << 5n;

export const DEFAULTS = {
	focus: 23,
	break: 5,
	longBreak: 15,
	rounds: 1,
	control: 'crew' as Control,
};
/** A long break follows every this-many focus blocks. */
export const LONG_BREAK_EVERY = 4;
/** A shared session whose voice channel has been empty this long ends. */
export const EMPTY_GRACE_MS = 5 * 60 * 1000;
/**
 * The sweep retries a deafen it could not lift for this long after the timebox
 * ended. After that only the member's next voice join lifts it (liftOnVoiceJoin),
 * so the record is kept, never dropped.
 */
export const RESTORE_GIVE_UP_MS = 24 * 60 * 60 * 1000;
/** Most people pinged at one change. */
const MAX_MENTIONS = 20;
/** The most blocks the catch-up loop will walk after an outage. */
const MAX_CATCH_UP_STEPS = 500;

const COLOR_FOCUS = 0xed4245;
const COLOR_BREAK = 0x57f287;
const COLOR_IDLE = 0x99aab5;

export type Phase = 'focus' | 'break' | 'long_break';
export type Status = 'running' | 'paused' | 'done' | 'stopped';
export type Control = 'crew' | 'anyone';
export type DeafenMode = 'none' | 'focus' | 'whole';

export interface Session {
	id: number;
	guild_id: string;
	channel_id: string;
	voice_channel_id: string | null;
	kind: 'solo' | 'shared';
	starter_id: string;
	focus_minutes: number;
	break_minutes: number;
	long_break_minutes: number;
	rounds: number;
	control: Control;
	phase: Phase;
	block_number: number;
	status: Status;
	phase_started_at: string;
	phase_ends_at: string | null;
	paused_remaining_ms: number | null;
	message_id: string | null;
	started_at: string;
	ended_at: string | null;
	end_reason: string | null;
	empty_since: string | null;
}

// --- the schedule: pure, no clock, no database -------------------------------

export function phaseMs(
	s: Pick<Session, 'focus_minutes' | 'break_minutes' | 'long_break_minutes'>,
	phase: Phase
): number {
	const minutes =
		phase === 'focus'
			? s.focus_minutes
			: phase === 'long_break'
				? s.long_break_minutes
				: s.break_minutes;
	return minutes * 60 * 1000;
}

/**
 * What follows the current block, or null when the timebox is over. `rounds` is
 * the number of focus blocks: after the last one there is no break, only done.
 */
export function nextStep(
	s: Pick<Session, 'phase' | 'block_number' | 'rounds'>
): { phase: Phase; block_number: number } | null {
	if (s.phase !== 'focus') return { phase: 'focus', block_number: s.block_number + 1 };
	if (s.block_number >= s.rounds) return null;
	return {
		phase: s.block_number % LONG_BREAK_EVERY === 0 ? 'long_break' : 'break',
		block_number: s.block_number,
	};
}

export interface Advanced {
	phase: Phase;
	block_number: number;
	phase_started_at: string;
	phase_ends_at: string;
	/** True when the last block ended and there is nothing after it. */
	finished: boolean;
	/** The moment the last block ended, when finished. */
	finished_at?: string;
	steps: number;
}

/**
 * Walk a running session forward to where it should be at `now`. Each block ends
 * where the last one's end time said it would, not at `now`, so a late sweep does
 * not stretch the schedule. After an outage this skips every block that came and
 * went; only the final state is announced.
 */
export function advance(s: Session, now: Date): Advanced {
	let phase = s.phase;
	let block = s.block_number;
	let started = new Date(s.phase_started_at).getTime();
	let ends = new Date(s.phase_ends_at as string).getTime();
	let steps = 0;
	while (ends <= now.getTime() && steps < MAX_CATCH_UP_STEPS) {
		const next = nextStep({ phase, block_number: block, rounds: s.rounds });
		if (!next) {
			return {
				phase,
				block_number: block,
				phase_started_at: new Date(started).toISOString(),
				phase_ends_at: new Date(ends).toISOString(),
				finished: true,
				finished_at: new Date(ends).toISOString(),
				steps,
			};
		}
		started = ends;
		phase = next.phase;
		block = next.block_number;
		ends = started + phaseMs(s, phase);
		steps++;
	}
	return {
		phase,
		block_number: block,
		phase_started_at: new Date(started).toISOString(),
		phase_ends_at: new Date(ends).toISOString(),
		finished: false,
		steps,
	};
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const iso = (ms: number) => new Date(ms).toISOString();

export function isController(permissions: unknown): boolean {
	const bits = parsePermissionBits(permissions);
	if (bits === null) return false;
	return (
		(bits & ADMINISTRATOR) === ADMINISTRATOR ||
		(bits & MANAGE_GUILD) === MANAGE_GUILD ||
		(bits & MANAGE_CHANNELS) === MANAGE_CHANNELS
	);
}

const PHASE_LABEL: Record<Phase, string> = {
	focus: 'Focus',
	break: 'Break',
	long_break: 'Long break',
};

// --- settings -----------------------------------------------------------------

export interface Settings {
	focus: number;
	break: number;
	longBreak: number;
	rounds: number;
	control: Control;
}

export async function getSettings(db, guildId: string): Promise<Settings> {
	const row: any = await db
		.prepare(`SELECT * FROM timebox_settings WHERE guild_id = ?`)
		.bind(guildId)
		.first();
	return {
		focus: row?.focus_minutes ?? DEFAULTS.focus,
		break: row?.break_minutes ?? DEFAULTS.break,
		longBreak: row?.long_break_minutes ?? DEFAULTS.longBreak,
		rounds: row?.rounds ?? DEFAULTS.rounds,
		control: row?.control === 'anyone' ? 'anyone' : 'crew',
	};
}

export async function upsertSettings(
	db,
	guildId: string,
	patch: Partial<{
		focus: number;
		break: number;
		longBreak: number;
		rounds: number;
		control: Control;
	}>
) {
	await db
		.prepare(
			`INSERT INTO timebox_settings (guild_id, focus_minutes, break_minutes, long_break_minutes, rounds, control)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(guild_id) DO UPDATE SET
			   focus_minutes = COALESCE(excluded.focus_minutes, focus_minutes),
			   break_minutes = COALESCE(excluded.break_minutes, break_minutes),
			   long_break_minutes = COALESCE(excluded.long_break_minutes, long_break_minutes),
			   rounds = COALESCE(excluded.rounds, rounds),
			   control = COALESCE(excluded.control, control),
			   updated_at = datetime('now')`
		)
		.bind(
			guildId,
			patch.focus ?? null,
			patch.break ?? null,
			patch.longBreak ?? null,
			patch.rounds ?? null,
			patch.control ?? null
		)
		.run();
}

// --- sessions -----------------------------------------------------------------

export async function getSession(db, id: number): Promise<Session | null> {
	return ((await db.prepare(`SELECT * FROM timebox_sessions WHERE id = ?`).bind(id).first()) ??
		null) as Session | null;
}

const LIVE = `status IN ('running', 'paused')`;

/** The live shared session for a voice channel. */
export async function liveForVoice(db, guildId: string, voiceChannelId: string) {
	return ((await db
		.prepare(
			`SELECT * FROM timebox_sessions WHERE guild_id = ? AND voice_channel_id = ? AND ${LIVE} ORDER BY id DESC LIMIT 1`
		)
		.bind(guildId, voiceChannelId)
		.first()) ?? null) as Session | null;
}

/** A member's live solo session in this server. */
export async function liveSoloFor(db, guildId: string, userId: string) {
	return ((await db
		.prepare(
			`SELECT * FROM timebox_sessions WHERE guild_id = ? AND kind = 'solo' AND starter_id = ? AND ${LIVE} ORDER BY id DESC LIMIT 1`
		)
		.bind(guildId, userId)
		.first()) ?? null) as Session | null;
}

/** What `/timebox status` and `stop` mean here: this VC's session, else the member's own. */
export async function sessionFor(
	db,
	guildId: string,
	userId: string,
	voiceChannelId: string | null
) {
	if (voiceChannelId) {
		const shared = await liveForVoice(db, guildId, voiceChannelId);
		if (shared) return shared;
	}
	return liveSoloFor(db, guildId, userId);
}

export async function createSession(
	db,
	input: {
		guild_id: string;
		channel_id: string;
		voice_channel_id: string | null;
		starter_id: string;
		focus: number;
		break: number;
		longBreak: number;
		rounds: number;
		control: Control;
	},
	now = new Date()
): Promise<Session> {
	const started = now.toISOString();
	const ends = iso(now.getTime() + input.focus * 60 * 1000);
	const res: any = await db
		.prepare(
			`INSERT INTO timebox_sessions
			 (guild_id, channel_id, voice_channel_id, kind, starter_id, focus_minutes, break_minutes,
			  long_break_minutes, rounds, control, phase, block_number, status, phase_started_at,
			  phase_ends_at, started_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'focus', 1, 'running', ?, ?, ?)
			 RETURNING id`
		)
		.bind(
			input.guild_id,
			input.channel_id,
			input.voice_channel_id,
			input.voice_channel_id ? 'shared' : 'solo',
			input.starter_id,
			input.focus,
			input.break,
			input.longBreak,
			input.rounds,
			input.control,
			started,
			ends,
			started
		)
		.first();
	return (await getSession(db, res.id)) as Session;
}

async function setMessage(db, id: number, messageId: string) {
	await db
		.prepare(`UPDATE timebox_sessions SET message_id = ? WHERE id = ?`)
		.bind(messageId, id)
		.run();
}

async function writePhase(db, id: number, a: Advanced) {
	await db
		.prepare(
			`UPDATE timebox_sessions SET phase = ?, block_number = ?, phase_started_at = ?, phase_ends_at = ?
			 WHERE id = ? AND status = 'running'`
		)
		.bind(a.phase, a.block_number, a.phase_started_at, a.phase_ends_at, id)
		.run();
}

async function writeEnd(db, id: number, status: 'done' | 'stopped', reason: string, at: string) {
	await db
		.prepare(
			`UPDATE timebox_sessions SET status = ?, end_reason = ?, ended_at = ?, phase_ends_at = NULL,
			   paused_remaining_ms = NULL WHERE id = ? AND ${LIVE}`
		)
		.bind(status, reason, at, id)
		.run();
}

// --- participants and the deafen ledger ----------------------------------------

export interface Participant {
	session_id: number;
	user_id: string;
	deafen_mode: DeafenMode;
	prev_deaf: number;
	prev_mute: number;
	applied: number;
	restore_pending: number;
	goal: string | null;
}

export async function getParticipant(db, sessionId: number, userId: string) {
	return ((await db
		.prepare(`SELECT * FROM timebox_participants WHERE session_id = ? AND user_id = ?`)
		.bind(sessionId, userId)
		.first()) ?? null) as Participant | null;
}

async function setDeafenMode(db, sessionId: number, userId: string, mode: DeafenMode) {
	await db
		.prepare(
			`INSERT INTO timebox_participants (session_id, user_id, deafen_mode) VALUES (?, ?, ?)
			 ON CONFLICT(session_id, user_id) DO UPDATE SET deafen_mode = excluded.deafen_mode, updated_at = datetime('now')`
		)
		.bind(sessionId, userId, mode)
		.run();
}

// --- goals ---------------------------------------------------------------------

export const GOAL_MAX = 200;
const MAX_GOALS_SHOWN = 8;

export interface Goal {
	user_id: string;
	goal: string;
	percent_done: number | null;
}

/** A goal is one short line: whitespace squeezed, trimmed, capped. Empty means none. */
export function cleanGoal(value: unknown): string | null {
	const text = String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, GOAL_MAX);
	return text || null;
}

export async function setGoal(db, sessionId: number, userId: string, goal: string) {
	await db
		.prepare(
			`INSERT INTO timebox_participants (session_id, user_id, goal) VALUES (?, ?, ?)
			 ON CONFLICT(session_id, user_id) DO UPDATE SET goal = excluded.goal, percent_done = NULL, updated_at = datetime('now')`
		)
		.bind(sessionId, userId, goal)
		.run();
}

/** Record how much of their goal a member got done. Needs a goal to measure against. */
export async function setPercent(db, sessionId: number, userId: string, percent: number) {
	const res: any = await db
		.prepare(
			`UPDATE timebox_participants SET percent_done = ?, updated_at = datetime('now')
			 WHERE session_id = ? AND user_id = ? AND goal IS NOT NULL`
		)
		.bind(percent, sessionId, userId)
		.run();
	return Number(res?.meta?.changes ?? 0) > 0;
}

export async function getGoals(db, sessionId: number): Promise<Goal[]> {
	const { results } = await db
		.prepare(
			`SELECT user_id, goal, percent_done FROM timebox_participants
			 WHERE session_id = ? AND goal IS NOT NULL ORDER BY rowid LIMIT ?`
		)
		.bind(sessionId, MAX_GOALS_SHOWN)
		.all();
	return (results || []) as Goal[];
}

/** The voice channel a member is in right now, from the gateway's live table. */
export async function voiceChannelOf(db, guildId: string, userId: string): Promise<string | null> {
	const row: any = await db
		.prepare(`SELECT channel_id FROM live_voice_states WHERE guild_id = ? AND user_id = ?`)
		.bind(guildId, userId)
		.first();
	return row?.channel_id ? String(row.channel_id) : null;
}

export async function humansInChannel(db, guildId: string, channelId: string): Promise<string[]> {
	const { results } = await db
		.prepare(
			`SELECT user_id FROM live_voice_states WHERE guild_id = ? AND channel_id = ? AND is_bot = 0 LIMIT ?`
		)
		.bind(guildId, channelId, MAX_MENTIONS)
		.all();
	return (results || []).map((r: any) => String(r.user_id));
}

/** Whether the mode wants the member deafened during this phase. */
export function wantsDeaf(mode: DeafenMode, phase: Phase): boolean {
	return mode === 'whole' || (mode === 'focus' && phase === 'focus');
}

type DeafOutcome = 'applied' | 'not_in_voice' | 'no_permission' | 'already' | 'error';

/**
 * Server-deafen and server-mute a member for this session, remembering what both
 * were before. Only a
 * member who is in a voice channel can be changed; anyone else is skipped and the
 * sweep tries again.
 */
export async function applyDeafen(db, discord, s: Session, userId: string): Promise<DeafOutcome> {
	const row = await getParticipant(db, s.id, userId);
	if (row?.applied) return 'already';
	if (!(await voiceChannelOf(db, s.guild_id, userId))) return 'not_in_voice';
	try {
		const member = await discord.members.fetch(s.guild_id, userId);
		const prev = member?.deaf ? 1 : 0;
		const prevMute = member?.mute ? 1 : 0;
		const change: { deaf?: boolean; mute?: boolean } = {};
		if (!prev) change.deaf = true;
		if (!prevMute) change.mute = true;
		if (change.deaf !== undefined || change.mute !== undefined)
			await discord.members.setVoice(
				s.guild_id,
				userId,
				change,
				'Timebox: deafened and muted at their request'
			);
		await db
			.prepare(
				`UPDATE timebox_participants SET applied = 1, restore_pending = 0, prev_deaf = ?, prev_mute = ?, updated_at = datetime('now')
				 WHERE session_id = ? AND user_id = ?`
			)
			.bind(prev, prevMute, s.id, userId)
			.run();
		return 'applied';
	} catch (err: any) {
		if (err?.status === 403) return 'no_permission';
		if (err?.status === 400) return 'not_in_voice';
		log.warn(`[Timebox] Could not deafen ${userId}: ${err?.message}`);
		return 'error';
	}
}

/**
 * Put back what the member's deafen and mute were before the bot touched them. If
 * they were already deafened or muted (by a moderator), that part is left alone. If Discord will not
 * change them right now — they are not in a voice channel — the row stays marked
 * `restore_pending` and the sweep retries.
 */
export async function restoreDeafen(
	db,
	discord,
	sessionId: number,
	userId: string,
	guildId: string
) {
	const row = await getParticipant(db, sessionId, userId);
	if (!row?.applied) return true;
	const done = () =>
		db
			.prepare(
				`UPDATE timebox_participants SET applied = 0, restore_pending = 0, updated_at = datetime('now')
				 WHERE session_id = ? AND user_id = ?`
			)
			.bind(sessionId, userId)
			.run();
	const change: { deaf?: boolean; mute?: boolean } = {};
	if (!row.prev_deaf) change.deaf = false;
	if (!row.prev_mute) change.mute = false;
	if (change.deaf === undefined && change.mute === undefined) {
		await done();
		return true;
	}
	try {
		await discord.members.setVoice(guildId, userId, change, 'Timebox: deafen and mute lifted');
		await done();
		return true;
	} catch (err: any) {
		if (err?.status === 404) {
			await done(); // left the server
			return true;
		}
		await db
			.prepare(
				`UPDATE timebox_participants SET restore_pending = 1, updated_at = datetime('now')
				 WHERE session_id = ? AND user_id = ?`
			)
			.bind(sessionId, userId)
			.run();
		return false;
	}
}

/**
 * A member who left voice before the bot could lift their timebox deafen/mute
 * has a record still marked `restore_pending`. Discord only lets us change a
 * server mute or deafen while the member is connected, so when they join voice
 * again and their session is over, lift it then. restoreDeafen puts back only
 * what the timebox itself changed. Sessions still live are left to the sweep.
 */
export async function liftOnVoiceJoin(db, discord, guildId: string, userId: string) {
	const { results } = await db
		.prepare(
			`SELECT p.session_id AS session_id FROM timebox_participants p
			 JOIN timebox_sessions s ON s.id = p.session_id
			 WHERE p.user_id = ? AND s.guild_id = ? AND p.restore_pending = 1
			   AND s.status NOT IN ('running', 'paused')`
		)
		.bind(userId, guildId)
		.all();
	let lifted = 0;
	for (const r of (results || []) as any[]) {
		if (await restoreDeafen(db, discord, r.session_id, userId, guildId)) lifted++;
	}
	return lifted;
}

async function heldParticipants(db, sessionId: number): Promise<Participant[]> {
	const { results } = await db
		.prepare(`SELECT * FROM timebox_participants WHERE session_id = ? AND applied = 1`)
		.bind(sessionId)
		.all();
	return (results || []) as Participant[];
}

async function allParticipants(db, sessionId: number): Promise<Participant[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM timebox_participants WHERE session_id = ? AND deafen_mode != 'none'`
		)
		.bind(sessionId)
		.all();
	return (results || []) as Participant[];
}

/** Lift every deafen the session holds. */
async function liftAll(db, discord, s: Session) {
	for (const p of await heldParticipants(db, s.id)) {
		await restoreDeafen(db, discord, s.id, p.user_id, s.guild_id);
	}
}

/** Lift or apply to match the phase the session just entered. */
async function syncDeafens(db, discord, s: Session) {
	for (const p of await allParticipants(db, s.id)) {
		if (wantsDeaf(p.deafen_mode, s.phase) && s.status === 'running') {
			if (!p.applied) await applyDeafen(db, discord, s, p.user_id);
		} else if (p.applied) {
			await restoreDeafen(db, discord, s.id, p.user_id, s.guild_id);
		}
	}
}

// --- the card -----------------------------------------------------------------

export interface CardExtra {
	deafened?: number;
	goals?: Goal[];
}

const goalLine = (g: Goal, shared: boolean, ended: boolean) =>
	`${shared ? `<@${g.user_id}>: ` : ''}${g.goal}${
		g.percent_done !== null ? ` — **${g.percent_done}%**` : ended ? ' — _percent not set_' : ''
	}`;

export function buildCard(s: Session, extra: CardExtra = {}) {
	const live = s.status === 'running' || s.status === 'paused';
	const title = !live
		? s.status === 'done'
			? 'Timebox finished'
			: 'Timebox stopped'
		: `${PHASE_LABEL[s.phase]}${s.phase === 'focus' && s.rounds > 1 ? ` · block ${s.block_number} of ${s.rounds}` : ''}`;
	const lines: string[] = [];
	if (s.status === 'running' && s.phase_ends_at) {
		lines.push(`Ends <t:${unix(s.phase_ends_at)}:R> (<t:${unix(s.phase_ends_at)}:t>)`);
	} else if (s.status === 'paused') {
		const left = Math.ceil((s.paused_remaining_ms ?? 0) / 60000);
		lines.push(`Paused with about ${left} min left`);
	} else if (s.status === 'done') {
		lines.push(`${s.rounds} focus ${s.rounds === 1 ? 'block' : 'blocks'} complete.`);
	} else {
		lines.push(
			s.end_reason === 'empty' ? 'Ended because the voice channel emptied.' : 'Ended early.'
		);
	}
	if (live) {
		const next = nextStep(s);
		if (next) lines.push(`Then: ${PHASE_LABEL[next.phase].toLowerCase()}`);
		else if (s.rounds > 1) lines.push('This is the last block.');
	}
	if (s.kind === 'shared' && live) lines.push(`Shared with <#${s.voice_channel_id}>`);
	if (extra.deafened) {
		lines.push(`${extra.deafened} deafened and muted at their own request`);
	}
	if (extra.goals?.length) {
		const plural = extra.goals.length > 1 || s.kind === 'shared';
		lines.push(
			`**${plural ? 'Goals' : 'Goal'}**\n` +
				extra.goals.map((g) => goalLine(g, s.kind === 'shared', !live)).join('\n')
		);
	}
	return {
		title,
		description: lines.join('\n'),
		color: !live ? COLOR_IDLE : s.phase === 'focus' ? COLOR_FOCUS : COLOR_BREAK,
		footer: {
			text:
				(s.rounds > 1
					? `${s.focus_minutes}/${s.break_minutes}/${s.long_break_minutes} min`
					: `${s.focus_minutes} min`) + (s.kind === 'solo' ? ' · solo' : ''),
		},
	};
}

export function buildComponents(s: Session, disabled = false, goals: Goal[] = []) {
	const live = s.status === 'running' || s.status === 'paused';
	if (!live && goals.length) {
		// Over: ask how it went. Each member answers for their own goal.
		return [
			{
				type: 1,
				components: [0, 25, 50, 75, 100].map((n) => ({
					type: 2,
					style: n === 100 ? 3 : 2,
					label: `${n}%`,
					custom_id: `timebox:pct:${s.id}:${n}`,
				})),
			},
		];
	}
	const off = disabled || !live;
	const btn = (action: string, label: string, style: number) => ({
		type: 2,
		style,
		label,
		custom_id: `timebox:${action}:${s.id}`,
		disabled: off,
	});
	return [
		{
			type: 1,
			components: [
				btn(
					s.status === 'paused' ? 'resume' : 'pause',
					s.status === 'paused' ? 'Resume' : 'Pause',
					2
				),
				btn('skip', 'Skip', 2),
				btn('stop', 'Stop', 4),
				btn('deafen', 'Deafen me', 2),
				openActivityButton(off),
			],
		},
	];
}

const ephemeral = (content: string) => ({
	type: RESPOND_MESSAGE,
	data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

function cardMessage(s: Session, extra: CardExtra = {}) {
	return {
		embeds: [buildCard(s, extra)],
		components: buildComponents(s, false, extra.goals),
		allowed_mentions: { parse: [] },
	};
}

async function cardExtra(db, s: Session): Promise<CardExtra> {
	return { deafened: await deafenedCount(db, s.id), goals: await getGoals(db, s.id) };
}

async function deafenedCount(db, sessionId: number): Promise<number> {
	const row: any = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM timebox_participants WHERE session_id = ? AND applied = 1 AND prev_deaf = 0`
		)
		.bind(sessionId)
		.first();
	return Number(row?.n ?? 0);
}

/** Who to ping at a change. */
async function audience(db, s: Session): Promise<string[]> {
	if (s.kind === 'solo') return [s.starter_id];
	const here = s.voice_channel_id
		? await humansInChannel(db, s.guild_id, s.voice_channel_id)
		: [];
	return here.length ? here : [s.starter_id];
}

function phaseAnnouncement(s: Session): string {
	if (s.status === 'done')
		return `Timebox finished: ${s.rounds} focus ${s.rounds === 1 ? 'block' : 'blocks'} done.`;
	const ends = s.phase_ends_at ? ` Ends <t:${unix(s.phase_ends_at)}:R>.` : '';
	if (s.phase === 'focus')
		return `Focus block ${s.block_number} of ${s.rounds} starts now.${ends}`;
	return `${PHASE_LABEL[s.phase]}.${ends}`;
}

/** Tell the channel what changed: edit the shared card, and ping the people in it. */
async function announce(db, discord, s: Session) {
	if (!discord) return;
	const extra = await cardExtra(db, s);
	const mentions = await audience(db, s);
	const over = s.status === 'done' || s.status === 'stopped';
	const askPercent =
		over && extra.goals?.length
			? ' How much of your goal did you get done? Press a percent on the card, or use `/timebox progress`.'
			: '';
	const content = `${mentions.map((id) => `<@${id}>`).join(' ')} ${phaseAnnouncement(s)}${askPercent}`;
	try {
		if (s.kind === 'shared' && s.message_id) {
			await discord.channels
				.editMessage(s.channel_id, s.message_id, cardMessage(s, extra))
				.catch((err) =>
					log.warn(`[Timebox] Could not edit card #${s.id}: ${err?.message}`)
				);
			await discord.channels.send(s.channel_id, {
				content,
				allowed_mentions: { users: mentions },
			});
		} else {
			// A solo card was an ephemeral reply, which cannot be edited for long, so each
			// change is a fresh message carrying the card and its buttons.
			await discord.channels.send(s.channel_id, {
				content,
				...cardMessage(s, extra),
				allowed_mentions: { users: mentions },
			});
		}
	} catch (err: any) {
		log.warn(`[Timebox] Could not announce #${s.id}: ${err?.message}`);
	}
}

// --- ending, skipping, pausing -------------------------------------------------

export async function endSession(
	db,
	discord,
	s: Session,
	reason: 'finished' | 'stopped' | 'empty',
	now = new Date(),
	endedAt?: string
) {
	await writeEnd(
		db,
		s.id,
		reason === 'finished' ? 'done' : 'stopped',
		reason,
		endedAt ?? now.toISOString()
	);
	const fresh = (await getSession(db, s.id)) as Session;
	await liftAll(db, discord, fresh);
	await announce(db, discord, fresh);
	return fresh;
}

/** Skip: end this block now and start the next, or finish if it was the last. */
export async function skipBlock(db, discord, s: Session, now = new Date()) {
	const next = nextStep(s);
	if (!next) return endSession(db, discord, s, 'finished', now);
	const started = now.getTime();
	await writePhase(db, s.id, {
		phase: next.phase,
		block_number: next.block_number,
		phase_started_at: now.toISOString(),
		phase_ends_at: iso(started + phaseMs(s, next.phase)),
		finished: false,
		steps: 1,
	});
	const fresh = (await getSession(db, s.id)) as Session;
	await syncDeafens(db, discord, fresh);
	await announce(db, discord, fresh);
	return fresh;
}

export async function pauseSession(db, discord, s: Session, now = new Date()) {
	if (s.status !== 'running' || !s.phase_ends_at) return s;
	const remaining = Math.max(0, new Date(s.phase_ends_at).getTime() - now.getTime());
	await db
		.prepare(
			`UPDATE timebox_sessions SET status = 'paused', paused_remaining_ms = ?, phase_ends_at = NULL
			 WHERE id = ? AND status = 'running'`
		)
		.bind(remaining, s.id)
		.run();
	const fresh = (await getSession(db, s.id)) as Session;
	await liftAll(db, discord, fresh); // a paused timebox holds nobody deafened
	return fresh;
}

export async function resumeSession(db, discord, s: Session, now = new Date()) {
	if (s.status !== 'paused') return s;
	const remaining = s.paused_remaining_ms ?? phaseMs(s, s.phase);
	await db
		.prepare(
			`UPDATE timebox_sessions SET status = 'running', phase_ends_at = ?, paused_remaining_ms = NULL
			 WHERE id = ? AND status = 'paused'`
		)
		.bind(iso(now.getTime() + remaining), s.id)
		.run();
	const fresh = (await getSession(db, s.id)) as Session;
	await syncDeafens(db, discord, fresh);
	return fresh;
}

// --- the minute sweep ----------------------------------------------------------

/**
 * Moves due sessions to their next block, keeps deafens in step with the phase,
 * ends shared sessions whose voice channel stayed empty, and retries deafens that
 * could not be lifted. With nothing live and nothing pending it is two indexed reads.
 */
export async function sweepTimebox(db, botTokenOrClient, now = new Date()) {
	const summary = {
		advanced: 0,
		finished: 0,
		ended_empty: 0,
		deafened: 0,
		restored: 0,
	};
	if (!db) return { ...summary, error: 'Database not available' };

	const { results: live } = await db
		.prepare(`SELECT * FROM timebox_sessions WHERE ${LIVE}`)
		.all();
	const { results: pending } = await db
		.prepare(
			`SELECT p.*, s.guild_id AS guild_id, s.ended_at AS ended_at FROM timebox_participants p
			 JOIN timebox_sessions s ON s.id = p.session_id
			 WHERE p.restore_pending = 1 AND (s.ended_at IS NULL OR s.ended_at > ?)`
		)
		.bind(new Date(now.getTime() - RESTORE_GIVE_UP_MS).toISOString())
		.all();
	if (!live?.length && !pending?.length) return summary;

	const discord =
		typeof botTokenOrClient === 'string'
			? (await import('../discord/rest-client.js')).createDiscordRestClient(botTokenOrClient)
			: botTokenOrClient;

	for (const s of (live || []) as Session[]) {
		try {
			// Shared: nobody in the voice channel for a while ends it.
			if (s.kind === 'shared' && s.voice_channel_id) {
				const here = await humansInChannel(db, s.guild_id, s.voice_channel_id);
				if (here.length === 0) {
					if (!s.empty_since) {
						await db
							.prepare(`UPDATE timebox_sessions SET empty_since = ? WHERE id = ?`)
							.bind(now.toISOString(), s.id)
							.run();
						s.empty_since = now.toISOString();
					} else if (
						now.getTime() - new Date(s.empty_since).getTime() >=
						EMPTY_GRACE_MS
					) {
						await endSession(db, discord, s, 'empty', now);
						summary.ended_empty++;
						continue;
					}
				} else if (s.empty_since) {
					await db
						.prepare(`UPDATE timebox_sessions SET empty_since = NULL WHERE id = ?`)
						.bind(s.id)
						.run();
					s.empty_since = null;
				}
			}

			if (s.status === 'running' && s.phase_ends_at && new Date(s.phase_ends_at) <= now) {
				const adv = advance(s, now);
				if (adv.finished) {
					await endSession(db, discord, s, 'finished', now, adv.finished_at);
					summary.finished++;
					continue;
				}
				await writePhase(db, s.id, adv);
				const fresh = (await getSession(db, s.id)) as Session;
				await syncDeafens(db, discord, fresh);
				await announce(db, discord, fresh);
				summary.advanced++;
				continue;
			}

			// Not due: pick up anyone who asked to be deafened and was not in a voice channel yet.
			if (s.status === 'running') {
				for (const p of await allParticipants(db, s.id)) {
					if (wantsDeaf(p.deafen_mode, s.phase) && !p.applied) {
						if ((await applyDeafen(db, discord, s, p.user_id)) === 'applied')
							summary.deafened++;
					}
				}
			}
		} catch (err: any) {
			log.error(`[Timebox] Sweep failed on session ${s.id}:`, err?.message || err);
		}
	}

	for (const p of (pending || []) as any[]) {
		if (await restoreDeafen(db, discord, p.session_id, p.user_id, p.guild_id))
			summary.restored++;
	}

	return summary;
}

// --- the command ---------------------------------------------------------------

type Interaction = Record<string, any>;

export interface TimeboxReply {
	response: Record<string, any>;
	after?: Promise<unknown>;
}

function optionMap(data: any) {
	const { leaves, subcommand } = flattenInteractionOptions(data);
	const opts: Record<string, any> = {};
	for (const leaf of leaves) opts[leaf.name] = leaf.value;
	return { opts, subcommand };
}

function intIn(value: unknown, min: number, max: number): number | null {
	if (value === undefined || value === null || value === '') return null;
	const n = Number(value);
	return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

/** A member may press a control if they started it, are Crew, or the server allows anyone in the VC. */
async function mayControl(db, s: Session, userId: string, perms: unknown): Promise<boolean> {
	if (s.starter_id === userId || isController(perms)) return true;
	if (s.kind === 'shared' && s.control === 'anyone' && s.voice_channel_id) {
		return (await voiceChannelOf(db, s.guild_id, userId)) === s.voice_channel_id;
	}
	return false;
}

/** Whether a member is part of a session: its starter, or in its shared voice channel. */
async function inSession(db, s: Session, userId: string): Promise<boolean> {
	return (
		s.starter_id === userId ||
		Boolean(
			s.kind === 'shared' &&
			s.voice_channel_id &&
			(await voiceChannelOf(db, s.guild_id, userId)) === s.voice_channel_id
		)
	);
}

/**
 * The session a goal command is about: the live one for this member, or, when
 * `orRecent`, the one that most recently ended with a goal of theirs in it.
 */
async function goalSession(db, guildId: string, userId: string, orRecent = false) {
	const vc = await voiceChannelOf(db, guildId, userId);
	const live = await sessionFor(db, guildId, userId, vc);
	if (live || !orRecent) return live;
	const row: any = await db
		.prepare(
			`SELECT s.id FROM timebox_sessions s
			 JOIN timebox_participants p ON p.session_id = s.id AND p.user_id = ?
			 WHERE s.guild_id = ? AND p.goal IS NOT NULL AND s.status IN ('done', 'stopped')
			 ORDER BY s.id DESC LIMIT 1`
		)
		.bind(userId, guildId)
		.first();
	return row ? getSession(db, Number(row.id)) : null;
}

/** Put a changed goal or percent on the card people are looking at, where it can be edited. */
async function refreshCard(db, discord, s: Session) {
	if (!discord || s.kind !== 'shared' || !s.message_id) return;
	await discord.channels
		.editMessage(s.channel_id, s.message_id, cardMessage(s, await cardExtra(db, s)))
		.catch((err) => log.warn(`[Timebox] Could not refresh card #${s.id}: ${err?.message}`));
}

export async function handleTimeboxCommand(body: Interaction, db, discord): Promise<TimeboxReply> {
	const guildId = body.guild_id;
	const channelId = body.channel_id;
	const userId = body.member?.user?.id || body.user?.id;
	if (!guildId || !channelId || !userId) {
		return { response: ephemeral('Timebox only works inside a server channel.') };
	}
	if (!db) return { response: ephemeral('The database is not available right now.') };
	// Discord only lists the command where it is enabled; this is the same check at
	// the point of use, so a stale registration cannot run it.
	if (!(await getCommandByName(db, 'timebox', guildId))) {
		return { response: ephemeral('Timebox is not turned on in this server.') };
	}

	const { opts, subcommand } = optionMap(body.data);
	const perms = body.member?.permissions;

	switch (subcommand) {
		case 'start':
			return startCommand(body, db, discord, opts, { guildId, channelId, userId });
		case 'stop': {
			const vc = await voiceChannelOf(db, guildId, userId);
			const s = await sessionFor(db, guildId, userId, vc);
			if (!s) return { response: ephemeral('No timebox is running for you here.') };
			if (!(await mayControl(db, s, userId, perms))) {
				return { response: ephemeral('Only the starter or Crew can stop this one.') };
			}
			await endSession(db, discord, s, 'stopped');
			return { response: ephemeral('Stopped. Any deafen or mute it held is lifted.') };
		}
		case 'status': {
			const vc = await voiceChannelOf(db, guildId, userId);
			const s = await sessionFor(db, guildId, userId, vc);
			if (!s) return { response: ephemeral('No timebox is running for you here.') };
			return {
				response: {
					type: RESPOND_MESSAGE,
					data: {
						...cardMessage(s, await cardExtra(db, s)),
						flags: EPHEMERAL,
					},
				},
			};
		}
		case 'goal': {
			const goal = cleanGoal(opts.text);
			if (!goal) return { response: ephemeral('Say what you want to get done.') };
			const s = await goalSession(db, guildId, userId);
			if (!s) return { response: ephemeral('No timebox is running for you here.') };
			if (!(await inSession(db, s, userId))) {
				return { response: ephemeral('Join the voice channel this timebox is for first.') };
			}
			await setGoal(db, s.id, userId, goal);
			return { response: ephemeral(`Goal set: ${goal}`) };
		}
		case 'progress': {
			const percent = intIn(opts.percent, 0, 100);
			if (percent === null || Number.isNaN(percent)) {
				return { response: ephemeral('`percent` is a whole number from 0 to 100.') };
			}
			// The timebox is usually over by now, so this looks at the live one first and
			// then at the one that last ended for this member.
			const s = await goalSession(db, guildId, userId, true);
			if (!s || !(await setPercent(db, s.id, userId, percent))) {
				return {
					response: ephemeral(
						'You have no goal to rate. Set one with `/timebox start goal:...` or `/timebox goal`.'
					),
				};
			}
			await refreshCard(db, discord, s);
			return { response: ephemeral(`Recorded: ${percent}% of your goal.`) };
		}
		case 'settings': {
			if (!isController(perms))
				return { response: ephemeral('Only Crew can change the defaults.') };
			const patch: any = {};
			for (const [key, name, min, max] of [
				['focus', 'focus', 1, 180],
				['break', 'break', 1, 60],
				['longBreak', 'long_break', 1, 120],
				['rounds', 'rounds', 1, 12],
			] as const) {
				const v = intIn(opts[name], min, max);
				if (Number.isNaN(v))
					return {
						response: ephemeral(`\`${name}\` is a whole number from ${min} to ${max}.`),
					};
				if (v !== null) patch[key] = v;
			}
			if (opts.control === 'crew' || opts.control === 'anyone') patch.control = opts.control;
			if (Object.keys(patch).length) await upsertSettings(db, guildId, patch);
			const now = await getSettings(db, guildId);
			return {
				response: ephemeral(
					`Defaults: ${now.focus} min focus, ${now.break} min break, ${now.longBreak} min long break after every ${LONG_BREAK_EVERY}th block, ${now.rounds} blocks. ` +
						`Pause, skip and stop: ${now.control === 'anyone' ? 'anyone in the voice channel' : 'the starter and Crew'}.`
				),
			};
		}
		default:
			return { response: ephemeral('Unknown /timebox subcommand.') };
	}
}

async function startCommand(
	body: Interaction,
	db,
	discord,
	opts: Record<string, any>,
	ctx: { guildId: string; channelId: string; userId: string }
): Promise<TimeboxReply> {
	const settings = await getSettings(db, ctx.guildId);
	const chosen: Record<string, number> = {};
	for (const [key, name, min, max, fallback] of [
		['focus', 'focus', 1, 180, settings.focus],
		['break', 'break', 1, 60, settings.break],
		['longBreak', 'long_break', 1, 120, settings.longBreak],
		['rounds', 'rounds', 1, 12, settings.rounds],
	] as const) {
		const v = intIn(opts[name], min, max);
		if (Number.isNaN(v))
			return { response: ephemeral(`\`${name}\` is a whole number from ${min} to ${max}.`) };
		chosen[key] = v ?? fallback;
	}

	const goal = cleanGoal(opts.goal);
	const deafen: DeafenMode =
		opts.deafen === 'focus' || opts.deafen === 'whole' ? opts.deafen : 'none';
	const vc = opts.solo ? null : await voiceChannelOf(db, ctx.guildId, ctx.userId);

	if (vc) {
		const existing = await liveForVoice(db, ctx.guildId, vc);
		if (existing) {
			return {
				response: ephemeral(
					`A timebox is already running in <#${vc}>. Use its card's **Deafen me** button to focus with it, or \`/timebox start solo:True\` for your own.`
				),
			};
		}
	} else if (await liveSoloFor(db, ctx.guildId, ctx.userId)) {
		return {
			response: ephemeral('You already have a timebox running. `/timebox stop` ends it.'),
		};
	}

	const s = await createSession(db, {
		guild_id: ctx.guildId,
		channel_id: ctx.channelId,
		voice_channel_id: vc,
		starter_id: ctx.userId,
		focus: chosen.focus,
		break: chosen.break,
		longBreak: chosen.longBreak,
		rounds: chosen.rounds,
		control: settings.control,
	});

	if (goal) await setGoal(db, s.id, ctx.userId, goal);

	let note = '';
	if (deafen !== 'none') {
		await setDeafenMode(db, s.id, ctx.userId, deafen);
		const out = await applyDeafen(db, discord, s, ctx.userId);
		note =
			out === 'applied'
				? '\nYou are deafened and muted. The **Deafen me** button lifts it any time.'
				: out === 'not_in_voice'
					? '\nJoin a voice channel and you will be deafened and muted within a minute.'
					: out === 'no_permission'
						? '\nI cannot deafen you here (I need Deafen Members and Mute Members, and a role above yours), so I left it off.'
						: '';
		if (out === 'no_permission') await setDeafenMode(db, s.id, ctx.userId, 'none');
	}

	const after =
		s.kind === 'shared'
			? (async () => {
					try {
						const res = await fetch(
							`https://discord.com/api/v10/webhooks/${body.application_id}/${body.token}/messages/@original`
						);
						if (!res.ok) throw new Error(`@original ${res.status}`);
						const msg: any = await res.json();
						if (msg?.id) await setMessage(db, s.id, msg.id);
					} catch (err: any) {
						log.warn(
							`[Timebox] Could not resolve the card for #${s.id}: ${err?.message}`
						);
					}
				})()
			: undefined;

	return {
		response: {
			type: RESPOND_MESSAGE,
			data: {
				...cardMessage(s, {
					deafened: deafen !== 'none' && note.startsWith('\nYou are') ? 1 : 0,
					goals: goal ? [{ user_id: ctx.userId, goal, percent_done: null }] : [],
				}),
				content:
					(s.kind === 'shared'
						? `Timebox started for <#${vc}>.`
						: 'Your timebox started. I will ping you in this channel at each change.') +
					note,
				...(s.kind === 'solo' ? { flags: EPHEMERAL } : {}),
				allowed_mentions: { parse: [] },
			},
		},
		after,
	};
}

// --- the buttons ---------------------------------------------------------------

export async function handleTimeboxComponent(
	body: Interaction,
	db,
	discord
): Promise<TimeboxReply> {
	const [, action, idText, idRest] = String(body.data?.custom_id || '').split(':');
	const id = Number(idText);
	const userId = body.member?.user?.id || body.user?.id;
	if (!db || !Number.isInteger(id) || !userId)
		return { response: ephemeral('That button has expired.') };

	const s = await getSession(db, id);
	if (!s) return { response: ephemeral('That timebox is gone.') };

	if (action === 'pct') {
		// The buttons on the finished card: each member rates their own goal.
		const percent = intIn(idRest, 0, 100);
		if (percent === null || Number.isNaN(percent))
			return { response: ephemeral('Unknown button.') };
		if (!(await setPercent(db, s.id, userId, percent))) {
			return {
				response: ephemeral(
					'You did not set a goal in this timebox, so there is nothing to rate.'
				),
			};
		}
		return {
			response: {
				type: RESPOND_UPDATE,
				data: cardMessage(s, await cardExtra(db, s)),
			},
		};
	}
	if (s.status !== 'running' && s.status !== 'paused') {
		return { response: ephemeral('That timebox has ended.') };
	}
	const perms = body.member?.permissions;

	if (action === 'deafen') {
		// Anyone may toggle their own deafen if they are in the session: the starter of a
		// solo one, or someone in the shared voice channel.
		const inSession =
			s.starter_id === userId ||
			(s.kind === 'shared' &&
				s.voice_channel_id &&
				(await voiceChannelOf(db, s.guild_id, userId)) === s.voice_channel_id);
		if (!inSession)
			return { response: ephemeral('Join the voice channel this timebox is for first.') };

		const mine = await getParticipant(db, s.id, userId);
		if (mine && mine.deafen_mode !== 'none') {
			await setDeafenMode(db, s.id, userId, 'none');
			await restoreDeafen(db, discord, s.id, userId, s.guild_id);
			return { response: ephemeral('Deafen off. You can hear and talk again.') };
		}
		await setDeafenMode(db, s.id, userId, 'focus');
		if (!wantsDeaf('focus', s.phase)) {
			return {
				response: ephemeral(
					'You will be deafened and muted during each focus block, starting with the next one.'
				),
			};
		}
		const out = await applyDeafen(db, discord, s, userId);
		if (out === 'no_permission') {
			await setDeafenMode(db, s.id, userId, 'none');
			return {
				response: ephemeral(
					'I cannot deafen you here: I need Deafen Members and Mute Members, and a role above yours.'
				),
			};
		}
		if (out === 'not_in_voice') {
			return {
				response: ephemeral(
					'Join a voice channel and you will be deafened and muted within a minute. Press again to turn it off.'
				),
			};
		}
		return {
			response: ephemeral(
				'Deafened for each focus block. Press the button again to lift it.'
			),
		};
	}

	if (!['pause', 'resume', 'skip', 'stop'].includes(action)) {
		return { response: ephemeral('Unknown button.') };
	}
	if (!(await mayControl(db, s, userId, perms))) {
		return {
			response: ephemeral(
				s.control === 'anyone'
					? 'Only someone in the voice channel, the starter, or Crew can do that.'
					: 'Only the starter or Crew can do that.'
			),
		};
	}

	let fresh: Session;
	if (action === 'pause') fresh = await pauseSession(db, discord, s);
	else if (action === 'resume') fresh = await resumeSession(db, discord, s);
	else if (action === 'skip') fresh = await skipBlock(db, discord, s);
	else fresh = await endSession(db, discord, s, 'stopped');

	return {
		response: {
			type: RESPOND_UPDATE,
			data: cardMessage(fresh, await cardExtra(db, fresh)),
		},
	};
}
