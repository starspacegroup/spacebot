/**
 * Quorum — one-command yes/no decisions that close themselves and post a result.
 *
 * `/quorum ask` posts a pinned question with Yes / No / Abstain buttons. Votes
 * update the card live; the minute sweep closes it at the deadline and posts a
 * RESULT card naming an owner and a due date, then nudges that owner once when
 * the date arrives. Below quorum there is no winner, only "no quorum".
 *
 * Privacy is the design constraint: the database holds counts, never who
 * voted. While a question is open, uniqueness is an HMAC of the voter's id
 * under the question's own salt; on close the vote rows are deleted and the
 * salt is nulled, so nothing can be joined back to a person afterwards.
 *
 * This module is shared by the interactions route (commands and buttons, on
 * the edge) and the cron route (the sweep), so it uses D1, Web Crypto and the
 * REST client only — nothing from discord.js.
 */

import { log } from '../log.js';
import { flattenInteractionOptions } from '../discord/interaction-options.js';
import { ADMINISTRATOR, parsePermissionBits } from '../discord/command-permissions.js';

// Interaction response types, numerically: this module must not depend on
// the `discord-interactions` package (tests mock it with a partial enum).
export const RESPOND_MESSAGE = 4; // CHANNEL_MESSAGE_WITH_SOURCE
export const RESPOND_UPDATE = 7; // UPDATE_MESSAGE
const EPHEMERAL = 64;

const MANAGE_GUILD = 1n << 5n;
const MANAGE_CHANNELS = 1n << 4n;
const MANAGE_MESSAGES = 1n << 13n;

export const CHOICES = ['yes', 'no', 'abstain'] as const;
export type Choice = (typeof CHOICES)[number];

export const CLASSES = ['general', 'owner-only', 'money', 'access', 'legal'] as const;
/** Classes refused at ask time unless a server opens them up. */
export const AUTO_ACTIONS = ['voice_channel', 'text_channel'] as const;
export type AutoAction = (typeof AUTO_ACTIONS)[number];
export const DEFAULT_AUTO_THRESHOLD = 66;

const AUTO_LABEL: Record<AutoAction, string> = {
	voice_channel: 'Create a voice channel',
	text_channel: 'Create a text channel',
};

export const DEFAULT_PROTECTED = ['owner-only', 'money', 'access', 'legal'];

export const DEFAULTS = {
	closesMinutes: 24 * 60,
	quorum: 5,
	dueMinutes: 7 * 24 * 60,
	footer: 'Advisory to the server owner',
};
export const MIN_CLOSES_MINUTES = 5;
export const MAX_CLOSES_MINUTES = 14 * 24 * 60;
/** How long before the deadline "Remind me" DMs go out. */
export const REMIND_BEFORE_MS = 15 * 60 * 1000;
/** An unanswered "done?" nudge becomes stale after this long. */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const LOG_LIMIT = 10;
const BAR_CELLS = 20;

const COLOR_OPEN = 0x57f287;
const COLOR_RESULT = 0x5865f2;
const COLOR_NO_QUORUM = 0x99aab5;
const COLOR_VETO = 0xed4245;

// --- small helpers -----------------------------------------------------------

/**
 * "24h", "90m", "2d", "1h30m" → minutes. A bare number is minutes. Null when
 * it is not a duration at all.
 */
export function parseDuration(text: unknown): number | null {
	if (text === null || text === undefined) return null;
	const s = String(text).trim().toLowerCase().replace(/\s+/g, '');
	if (!s) return null;
	if (/^\d+$/.test(s)) return Number(s);
	const re = /(\d+(?:\.\d+)?)([dhm])/g;
	let total = 0;
	let matched = '';
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) {
		matched += m[0];
		const n = Number(m[1]);
		total += m[2] === 'd' ? n * 1440 : m[2] === 'h' ? n * 60 : n;
	}
	if (matched !== s || total <= 0) return null;
	return Math.round(total);
}

export function formatDuration(minutes: number): string {
	if (minutes % 1440 === 0) return `${minutes / 1440}d`;
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	if (minutes > 60) return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
	return `${minutes}m`;
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const isoAfter = (from: Date, minutes: number) =>
	new Date(from.getTime() + minutes * 60 * 1000).toISOString();

/** Who may attach a channel-creating action: Manage Channels, or Administrator. */
export function canManageChannels(permissions: unknown): boolean {
	const bits = parsePermissionBits(permissions);
	if (bits === null) return false;
	return (bits & ADMINISTRATOR) === ADMINISTRATOR || (bits & MANAGE_CHANNELS) === MANAGE_CHANNELS;
}

/** Crew: anyone who can manage the server or its messages. Admins always. */
export function isCrew(permissions: unknown): boolean {
	const bits = parsePermissionBits(permissions);
	if (bits === null) return false;
	return (
		(bits & ADMINISTRATOR) === ADMINISTRATOR ||
		(bits & MANAGE_GUILD) === MANAGE_GUILD ||
		(bits & MANAGE_MESSAGES) === MANAGE_MESSAGES
	);
}

function randomSalt(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256(salt, userId), hex. The only form a voter's id ever takes here. */
export async function voterHash(salt: string, userId: string): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(salt),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode(userId));
	return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

const ephemeral = (content: string) => ({
	type: RESPOND_MESSAGE,
	data: { content, flags: EPHEMERAL },
});

const ownerMention = (q: { owner_kind: string; owner_id: string }) =>
	q.owner_kind === 'role' ? `<@&${q.owner_id}>` : `<@${q.owner_id}>`;

function parseJsonArray(value: unknown, fallback: string[]): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (value === null || value === undefined || value === '') return fallback;
	try {
		const parsed = JSON.parse(String(value));
		return Array.isArray(parsed) ? parsed.map(String) : fallback;
	} catch {
		return fallback;
	}
}

// --- settings ----------------------------------------------------------------

export interface QuorumSettings {
	closes_minutes: number;
	quorum: number;
	footer_text: string;
	announce_channel_id: string | null;
	protected_classes: string[];
	classes_locked: boolean;
}

/**
 * Effective settings for a channel: the channel row over the guild default
 * (channel_id '') over the built-in defaults. Server-wide fields (footer,
 * announce channel, protected classes, lock) are read from the guild row only.
 */
export async function getSettings(db, guildId: string, channelId: string): Promise<QuorumSettings> {
	const rows = await db
		.prepare(`SELECT * FROM quorum_settings WHERE guild_id = ? AND channel_id IN ('', ?)`)
		.bind(guildId, channelId)
		.all();
	const list = rows?.results || [];
	const guild = list.find((r) => r.channel_id === '') || {};
	const channel = list.find((r) => r.channel_id === channelId) || {};
	return {
		closes_minutes: channel.closes_minutes ?? guild.closes_minutes ?? DEFAULTS.closesMinutes,
		quorum: channel.quorum ?? guild.quorum ?? DEFAULTS.quorum,
		footer_text: guild.footer_text || DEFAULTS.footer,
		announce_channel_id: guild.announce_channel_id || null,
		protected_classes: parseJsonArray(guild.protected_classes, DEFAULT_PROTECTED),
		classes_locked: guild.classes_locked === 1 || guild.classes_locked === true,
	};
}

export async function upsertSettings(
	db,
	guildId: string,
	channelId: string,
	patch: Partial<{
		closes_minutes: number;
		quorum: number;
		footer_text: string;
		announce_channel_id: string | null;
		protected_classes: string[];
		classes_locked: boolean;
	}>
) {
	await db
		.prepare(
			`INSERT INTO quorum_settings (guild_id, channel_id) VALUES (?, ?)
			 ON CONFLICT(guild_id, channel_id) DO NOTHING`
		)
		.bind(guildId, channelId)
		.run();
	const sets: string[] = [];
	const args: unknown[] = [];
	if (patch.closes_minutes !== undefined) {
		sets.push('closes_minutes = ?');
		args.push(patch.closes_minutes);
	}
	if (patch.quorum !== undefined) {
		sets.push('quorum = ?');
		args.push(patch.quorum);
	}
	if (patch.footer_text !== undefined) {
		sets.push('footer_text = ?');
		args.push(patch.footer_text);
	}
	if (patch.announce_channel_id !== undefined) {
		sets.push('announce_channel_id = ?');
		args.push(patch.announce_channel_id);
	}
	if (patch.protected_classes !== undefined) {
		sets.push('protected_classes = ?');
		args.push(JSON.stringify(patch.protected_classes));
	}
	if (patch.classes_locked !== undefined) {
		sets.push('classes_locked = ?');
		args.push(patch.classes_locked ? 1 : 0);
	}
	if (sets.length === 0) return;
	sets.push(`updated_at = datetime('now')`);
	await db
		.prepare(
			`UPDATE quorum_settings SET ${sets.join(', ')} WHERE guild_id = ? AND channel_id = ?`
		)
		.bind(...args, guildId, channelId)
		.run();
}

// --- questions ---------------------------------------------------------------

export interface Question {
	id: number;
	guild_id: string;
	channel_id: string;
	message_id: string | null;
	asker_id: string;
	question: string;
	class: string | null;
	quorum: number;
	closes_at: string;
	due_at: string;
	owner_kind: 'user' | 'role';
	owner_id: string;
	salt: string | null;
	yes_count: number;
	no_count: number;
	abstain_count: number;
	status: 'open' | 'closed' | 'no_quorum' | 'vetoed';
	result: 'yes' | 'no' | 'tie' | null;
	closed_reason: 'deadline' | 'early' | null;
	closed_by: string | null;
	closed_at: string | null;
	result_message_id: string | null;
	veto_reason: string | null;
	vetoed_at: string | null;
	followup_status: 'asked' | 'done' | 'stale' | null;
	followup_asked_at: string | null;
	followup_message_id: string | null;
	reminded_at: string | null;
	auto_action: AutoAction | null;
	auto_name: string | null;
	auto_threshold: number | null;
	auto_status: 'done' | 'failed' | 'not_met' | null;
	auto_channel_id: string | null;
	created_at: string;
}

export async function getQuestion(db, id: number): Promise<Question | null> {
	return (
		(await db.prepare(`SELECT * FROM quorum_questions WHERE id = ?`).bind(id).first()) ?? null
	);
}

export async function latestOpenInChannel(db, guildId: string, channelId: string) {
	return (
		(await db
			.prepare(
				`SELECT * FROM quorum_questions WHERE guild_id = ? AND channel_id = ? AND status = 'open'
				 ORDER BY id DESC LIMIT 1`
			)
			.bind(guildId, channelId)
			.first()) ?? null
	);
}

export async function latestSettledInChannel(db, guildId: string, channelId: string) {
	return (
		(await db
			.prepare(
				`SELECT * FROM quorum_questions WHERE guild_id = ? AND channel_id = ? AND status != 'open'
				 ORDER BY closed_at DESC, id DESC LIMIT 1`
			)
			.bind(guildId, channelId)
			.first()) ?? null
	);
}

export async function listLog(db, guildId: string, limit = LOG_LIMIT): Promise<Question[]> {
	const rows = await db
		.prepare(
			`SELECT * FROM quorum_questions WHERE guild_id = ? AND status != 'open'
			 ORDER BY closed_at DESC, id DESC LIMIT ?`
		)
		.bind(guildId, limit)
		.all();
	return rows?.results || [];
}

export async function createQuestion(
	db,
	input: {
		guild_id: string;
		channel_id: string;
		asker_id: string;
		question: string;
		class: string | null;
		quorum: number;
		closes_minutes: number;
		due_minutes: number;
		owner_kind: 'user' | 'role';
		owner_id: string;
		auto?: { action: AutoAction; name: string; threshold: number } | null;
	},
	now = new Date()
): Promise<Question> {
	const salt = randomSalt();
	const closesAt = isoAfter(now, input.closes_minutes);
	const dueAt = isoAfter(new Date(closesAt), input.due_minutes);
	const row = await db
		.prepare(
			`INSERT INTO quorum_questions
			   (guild_id, channel_id, asker_id, question, class, quorum, closes_at, due_at,
			    owner_kind, owner_id, salt, created_at, auto_action, auto_name, auto_threshold)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 RETURNING *`
		)
		.bind(
			input.guild_id,
			input.channel_id,
			input.asker_id,
			input.question,
			input.class,
			input.quorum,
			closesAt,
			dueAt,
			input.owner_kind,
			input.owner_id,
			salt,
			now.toISOString(),
			input.auto?.action ?? null,
			input.auto?.name ?? null,
			input.auto?.threshold ?? null
		)
		.first();
	return row;
}

export async function setQuestionMessage(db, id: number, messageId: string) {
	await db
		.prepare(`UPDATE quorum_questions SET message_id = ? WHERE id = ?`)
		.bind(messageId, id)
		.run();
}

/**
 * Record a vote, or change one. Counts are recomputed from the vote rows
 * rather than nudged up and down, so they always sum to the votes cast.
 * Returns the fresh question row, or null if it is no longer open.
 */
export async function castVote(db, question: Question, userId: string, choice: Choice) {
	if (question.status !== 'open' || !question.salt) return null;
	const hash = await voterHash(question.salt, userId);
	await db
		.prepare(
			`INSERT INTO quorum_votes (question_id, voter_hash, choice) VALUES (?, ?, ?)
			 ON CONFLICT(question_id, voter_hash) DO UPDATE SET choice = excluded.choice`
		)
		.bind(question.id, hash, choice)
		.run();
	await db
		.prepare(
			`UPDATE quorum_questions SET
			   yes_count = (SELECT COUNT(*) FROM quorum_votes WHERE question_id = ? AND choice = 'yes'),
			   no_count = (SELECT COUNT(*) FROM quorum_votes WHERE question_id = ? AND choice = 'no'),
			   abstain_count = (SELECT COUNT(*) FROM quorum_votes WHERE question_id = ? AND choice = 'abstain')
			 WHERE id = ? AND status = 'open'`
		)
		.bind(question.id, question.id, question.id, question.id)
		.run();
	return getQuestion(db, question.id);
}

export async function addReminder(db, questionId: number, userId: string) {
	await db
		.prepare(`INSERT OR IGNORE INTO quorum_reminders (question_id, user_id) VALUES (?, ?)`)
		.bind(questionId, userId)
		.run();
}

// --- the arithmetic ----------------------------------------------------------

export interface Tally {
	total: number;
	yesPct: number;
	noPct: number;
	abstainPct: number;
	reached: boolean;
	winner: 'yes' | 'no' | 'tie' | null;
}

export function tally(q: {
	yes_count: number;
	no_count: number;
	abstain_count: number;
	quorum: number;
}): Tally {
	const total = q.yes_count + q.no_count + q.abstain_count;
	const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
	const reached = total >= q.quorum;
	let winner: Tally['winner'] = null;
	if (reached) {
		winner = q.yes_count > q.no_count ? 'yes' : q.no_count > q.yes_count ? 'no' : 'tie';
	}
	return {
		total,
		yesPct: pct(q.yes_count),
		noPct: pct(q.no_count),
		abstainPct: pct(q.abstain_count),
		reached,
		winner,
	};
}

/** Twenty cells: green for yes, red for no, white for abstain, in proportion. */
export function bar(q: { yes_count: number; no_count: number; abstain_count: number }): string {
	const total = q.yes_count + q.no_count + q.abstain_count;
	if (total === 0) return '⬜'.repeat(BAR_CELLS);
	let yes = Math.round((q.yes_count / total) * BAR_CELLS);
	let no = Math.round((q.no_count / total) * BAR_CELLS);
	// Rounding can over- or under-fill by one; the abstain share absorbs it.
	if (yes + no > BAR_CELLS) yes > no ? (yes -= 1) : (no -= 1);
	const abstain = BAR_CELLS - yes - no;
	return '🟩'.repeat(yes) + '🟥'.repeat(no) + '⬜'.repeat(abstain);
}

// --- cards -------------------------------------------------------------------

/**
 * Did the vote pass far enough to trigger the question's action? Needs quorum,
 * and yes at or above the threshold percent of the yes + no votes. Integer
 * arithmetic, so 2 of 3 is exactly 66.67% and clears 66 but not 67.
 */
export function autoMet(q: {
	yes_count: number;
	no_count: number;
	abstain_count: number;
	quorum: number;
	auto_threshold: number | null;
}): boolean {
	if (!tally(q).reached) return false;
	const decisive = q.yes_count + q.no_count;
	return decisive > 0 && q.yes_count * 100 >= (q.auto_threshold ?? 100) * decisive;
}

/** What the question will do, in one line, for the card. */
function autoSummary(q: Question): string | null {
	if (!q.auto_action) return null;
	const label = AUTO_LABEL[q.auto_action] ?? q.auto_action;
	return `${label} “${q.auto_name}” if yes is ${q.auto_threshold}% or more of yes and no votes`;
}

export function buildQuestionEmbed(q: Question) {
	const t = tally(q);
	const closed = q.status !== 'open';
	const quorumText = t.reached
		? `${q.quorum} · reached ✓`
		: `${q.quorum} · ${q.quorum - t.total} to go`;
	return {
		title: q.question,
		description: closed
			? 'Closed. The result is posted below.'
			: 'One vote per member. Closes by itself. Result posts here.',
		color: closed ? COLOR_NO_QUORUM : COLOR_OPEN,
		fields: [
			{
				name: closed ? 'Closed' : 'Closes',
				value: closed
					? `<t:${unix(q.closed_at || q.closes_at)}:f>`
					: `<t:${unix(q.closes_at)}:R> · <t:${unix(q.closes_at)}:f>`,
				inline: true,
			},
			{ name: 'Quorum', value: quorumText, inline: true },
			{ name: 'Voted', value: String(t.total), inline: true },
			{
				name: '​',
				value: `${bar(q)}\n${t.yesPct}% yes · ${t.noPct}% no · ${t.abstainPct}% abstain · counts only, no names`,
				inline: false,
			},
			...(q.auto_action
				? [{ name: 'If it passes', value: autoSummary(q) as string, inline: false }]
				: []),
		],
		footer: { text: `Question #${q.id} · Quorum keeps counts, never who voted` },
	};
}

export function buildQuestionComponents(q: Question, disabled = false) {
	const btn = (label: string, style: number, custom_id: string) => ({
		type: 2,
		style,
		label,
		custom_id,
		disabled,
	});
	return [
		{
			type: 1,
			components: [
				btn('✓ Yes', 3, `quorum:vote:${q.id}:yes`),
				btn('✗ No', 4, `quorum:vote:${q.id}:no`),
				btn('Abstain', 2, `quorum:vote:${q.id}:abstain`),
			],
		},
		{
			type: 1,
			components: [btn('Remind me before close', 2, `quorum:remind:${q.id}`)],
		},
	];
}

/** What became of the question's action, for the RESULT card. */
function autoOutcome(q: Question): string {
	const label = AUTO_LABEL[q.auto_action as AutoAction] ?? q.auto_action;
	if (q.auto_status === 'done')
		return `${label}: done${q.auto_channel_id ? ` — <#${q.auto_channel_id}>` : ''}`;
	if (q.auto_status === 'failed') return `${label}: passed, but it could not be done`;
	if (q.auto_status === 'not_met')
		return `${label}: not done — it needed ${q.auto_threshold}% yes and quorum`;
	return autoSummary(q) as string;
}

export function buildResultEmbed(q: Question, settings: { footer_text: string }) {
	const t = tally(q);
	const closedHow = q.closed_reason === 'early' ? 'Closed early.' : 'Closed on time.';
	let description: string;
	let decision: string;
	let color = COLOR_RESULT;
	if (q.status === 'vetoed') {
		description = `Vetoed by the server owner: ${q.veto_reason || 'no reason given'}`;
		decision = 'Vetoed';
		color = COLOR_VETO;
	} else if (!t.reached) {
		description = `**No quorum.** ${t.total} of ${q.quorum} votes needed. No result. ${closedHow}`;
		decision = 'No quorum';
		color = COLOR_NO_QUORUM;
	} else if (t.winner === 'tie') {
		description = `**Tie.** ${q.yes_count} yes, ${q.no_count} no of ${t.total} votes. Quorum ${q.quorum} reached. ${closedHow}`;
		decision = 'Tie — no result';
		color = COLOR_NO_QUORUM;
	} else {
		const pct = t.winner === 'yes' ? t.yesPct : t.noPct;
		description = `**${t.winner === 'yes' ? 'Yes' : 'No'}** wins, ${pct}% of ${t.total} votes. Quorum ${q.quorum} reached. ${closedHow}`;
		decision = t.winner === 'yes' ? 'Yes' : 'No';
	}
	const followup =
		q.followup_status === 'done'
			? ' · done ✓'
			: q.followup_status === 'stale'
				? ' · stale'
				: '';
	return {
		title: `RESULT · ${q.question}`,
		description,
		color,
		fields: [
			{ name: 'Decision', value: decision, inline: true },
			{ name: 'Owner', value: ownerMention(q), inline: true },
			{ name: 'Due', value: `<t:${unix(q.due_at)}:D>${followup}`, inline: true },
			...(q.auto_action ? [{ name: 'Then', value: autoOutcome(q), inline: false }] : []),
		],
		footer: { text: `Question #${q.id} · ${settings.footer_text}` },
	};
}

export function buildLogEmbed(questions: Question[]) {
	const word = (q: Question) => {
		if (q.status === 'vetoed') return 'vetoed';
		if (q.status === 'no_quorum') return 'no quorum';
		if (q.result === 'tie') return 'tie';
		if (q.followup_status === 'done') return 'done';
		if (q.followup_status === 'stale') return 'stale';
		return 'open'; // decided, follow-through still pending
	};
	const lines = questions.map((q) => {
		const t = tally(q);
		const outcome =
			q.status === 'closed' && t.winner && t.winner !== 'tie'
				? `**${t.winner === 'yes' ? 'Yes' : 'No'}** ${t.winner === 'yes' ? t.yesPct : t.noPct}%`
				: word(q);
		return `#${q.id} · ${q.question} — ${outcome} (${t.total} votes) · ${ownerMention(q)} · <t:${unix(q.due_at)}:D> · ${word(q)}`;
	});
	return {
		title: 'Decisions',
		description: lines.length ? lines.join('\n') : 'No decisions yet.',
		color: COLOR_RESULT,
		footer: { text: 'Newest first · /quorum ask to start one' },
	};
}

export function buildFollowupMessage(q: Question, settled: 'done' | 'stale' | null = null) {
	const content =
		settled === 'done'
			? `✓ Done — ${ownerMention(q)} followed through on **${q.question}**.`
			: settled === 'stale'
				? `Stale — **${q.question}** was decided but not acted on by its due date.`
				: `${ownerMention(q)} — **${q.question}** was due <t:${unix(q.due_at)}:D>. Done?`;
	return {
		content,
		allowed_mentions: settled ? { parse: [] } : { users: [q.owner_id], roles: [q.owner_id] },
		components: settled
			? []
			: [
					{
						type: 1,
						components: [
							{
								type: 2,
								style: 3,
								label: 'Done',
								custom_id: `quorum:followup:${q.id}:done`,
							},
							{
								type: 2,
								style: 2,
								label: 'Not yet',
								custom_id: `quorum:followup:${q.id}:stale`,
							},
						],
					},
				],
	};
}

// --- closing -----------------------------------------------------------------

/**
 * Settle a question: freeze the counts, forget the voters, retire the card,
 * post the RESULT. Idempotent on the row (a second call sees it closed).
 */
export async function closeQuestion(
	db,
	discord,
	question: Question,
	opts: { reason: 'deadline' | 'early'; by?: string | null; now?: Date }
): Promise<Question | null> {
	const now = opts.now ?? new Date();
	const t = tally(question);
	const status = t.reached ? 'closed' : 'no_quorum';
	const result = t.reached ? t.winner : null;
	const updated = await db
		.prepare(
			`UPDATE quorum_questions
			 SET status = ?, result = ?, closed_reason = ?, closed_by = ?, closed_at = ?, salt = NULL
			 WHERE id = ? AND status = 'open'`
		)
		.bind(status, result, opts.reason, opts.by ?? null, now.toISOString(), question.id)
		.run();
	if (updated?.meta && updated.meta.changes === 0) return null; // already closed by another path
	await db.prepare(`DELETE FROM quorum_votes WHERE question_id = ?`).bind(question.id).run();
	await db.prepare(`DELETE FROM quorum_reminders WHERE question_id = ?`).bind(question.id).run();

	const q = (await getQuestion(db, question.id)) as Question;
	const settings = await getSettings(db, q.guild_id, q.channel_id);

	if (discord) {
		if (q.message_id) {
			await discord.channels
				.editMessage(q.channel_id, q.message_id, {
					embeds: [buildQuestionEmbed(q)],
					components: buildQuestionComponents(q, true),
				})
				.catch((err) =>
					log.warn(`[Quorum] Could not retire card #${q.id}: ${err?.message}`)
				);
			await discord.channels
				.unpin(q.channel_id, q.message_id, 'Quorum question closed')
				.catch(() => {});
		}
		try {
			const posted = await discord.channels.send(q.channel_id, {
				embeds: [buildResultEmbed(q, settings)],
				allowed_mentions: { parse: [] },
			});
			if (posted?.id) {
				await db
					.prepare(`UPDATE quorum_questions SET result_message_id = ? WHERE id = ?`)
					.bind(posted.id, q.id)
					.run();
				q.result_message_id = posted.id;
			}
		} catch (err) {
			log.error(`[Quorum] Could not post result #${q.id}: ${err?.message}`);
		}
		if (settings.announce_channel_id && settings.announce_channel_id !== q.channel_id) {
			await discord.channels
				.send(settings.announce_channel_id, {
					embeds: [buildResultEmbed(q, settings)],
					allowed_mentions: { parse: [] },
				})
				.catch((err) =>
					log.warn(`[Quorum] Could not mirror result #${q.id}: ${err?.message}`)
				);
		}
	}
	if (q.auto_action) await runAutoAction(db, discord, q);
	return (await getQuestion(db, q.id)) as Question;
}

/**
 * Carry out the question's action if the vote cleared its bar. Runs once, from
 * the close that won the row, so a retried sweep cannot make two channels. The
 * outcome is written to the row and said in the channel, so a refusal from
 * Discord is never silent.
 */
async function runAutoAction(db, discord, q: Question) {
	const setStatus = (status: string, channelId: string | null = null) =>
		db
			.prepare(
				`UPDATE quorum_questions SET auto_status = ?, auto_channel_id = ? WHERE id = ?`
			)
			.bind(status, channelId, q.id)
			.run();

	if (!autoMet(q)) {
		await setStatus('not_met');
		return;
	}
	const say = (content: string) =>
		discord?.channels
			?.send(q.channel_id, { content, allowed_mentions: { parse: [] } })
			.catch((err) => log.warn(`[Quorum] Could not post outcome #${q.id}: ${err?.message}`));
	try {
		if (!discord) throw new Error('no Discord client');
		const voice = q.auto_action === 'voice_channel';
		// Put it beside where the question was asked, when that can be found.
		const parent = await discord.channels
			.fetch(q.channel_id)
			.then((c: any) => c?.parent_id ?? undefined)
			.catch(() => undefined);
		const guild = await discord.guilds.fetch(q.guild_id);
		const created = await guild.channels.create({
			name: channelName(q.auto_name as string, voice),
			type: voice ? 2 : 0,
			parent,
			reason: `Quorum question #${q.id} passed`,
		});
		await setStatus('done', created?.id ?? null);
		await say(
			`✅ Question #${q.id} passed: created ${voice ? 'voice' : 'text'} channel ${created?.id ? `<#${created.id}>` : `“${q.auto_name}”`}.`
		);
	} catch (err: any) {
		log.error(`[Quorum] Auto-action for #${q.id} failed: ${err?.message}`);
		await setStatus('failed');
		await say(
			`⚠️ Question #${q.id} passed, but I could not create the channel (${err?.message || 'Discord refused'}). I need Manage Channels; someone who has it can make it by hand.`
		);
	}
	// The RESULT card was posted before the outcome was known; bring it up to date.
	if (discord && q.result_message_id) {
		const fresh = (await getQuestion(db, q.id)) as Question;
		const settings = await getSettings(db, fresh.guild_id, fresh.channel_id);
		await discord.channels
			.editMessage(fresh.channel_id, q.result_message_id, {
				embeds: [buildResultEmbed(fresh, settings)],
				allowed_mentions: { parse: [] },
			})
			.catch(() => {});
	}
}

/** Discord text channels are lowercase with hyphens; voice names are free text. */
export function channelName(name: string, voice: boolean): string {
	const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, 100);
	if (voice) return cleaned || 'voice';
	return (
		cleaned
			.toLowerCase()
			.replace(/[^a-z0-9_ -]/g, '')
			.replace(/[ ]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '') || 'new-channel'
	);
}

// --- the minute sweep --------------------------------------------------------

export async function sweepQuorum(db, botTokenOrClient, now = new Date()) {
	const summary = { reminded: 0, closed: 0, nudged: 0, staled: 0, failed: 0 };
	if (!db) return { ...summary, error: 'Database not available' };

	const discord =
		typeof botTokenOrClient === 'string'
			? (await import('../discord/rest-client.js')).createDiscordRestClient(botTokenOrClient)
			: botTokenOrClient;
	const nowIso = now.toISOString();

	// 1. Reminders: open questions inside the reminder window that have not
	//    sent theirs yet. Cheap when nothing is open — one indexed read.
	const soon = new Date(now.getTime() + REMIND_BEFORE_MS).toISOString();
	const dueReminders = await db
		.prepare(
			`SELECT * FROM quorum_questions WHERE status = 'open' AND reminded_at IS NULL AND closes_at <= ?`
		)
		.bind(soon)
		.all();
	for (const q of dueReminders?.results || []) {
		const subs = await db
			.prepare(`SELECT user_id FROM quorum_reminders WHERE question_id = ?`)
			.bind(q.id)
			.all();
		for (const sub of subs?.results || []) {
			try {
				await discord?.users.dm(
					sub.user_id,
					`**${q.question}** closes <t:${unix(q.closes_at)}:R> in <#${q.channel_id}>. You asked to be reminded.`
				);
				summary.reminded++;
			} catch (err) {
				summary.failed++;
				log.warn(`[Quorum] Reminder DM failed for #${q.id}: ${err?.message}`);
			}
		}
		await db.prepare(`DELETE FROM quorum_reminders WHERE question_id = ?`).bind(q.id).run();
		await db
			.prepare(`UPDATE quorum_questions SET reminded_at = ? WHERE id = ?`)
			.bind(nowIso, q.id)
			.run();
	}

	// 2. Deadlines.
	const due = await db
		.prepare(`SELECT * FROM quorum_questions WHERE status = 'open' AND closes_at <= ?`)
		.bind(nowIso)
		.all();
	for (const q of due?.results || []) {
		try {
			if (await closeQuestion(db, discord, q, { reason: 'deadline', now })) summary.closed++;
		} catch (err) {
			summary.failed++;
			log.error(`[Quorum] Close failed for #${q.id}: ${err?.message}`);
		}
	}

	// 3. Follow-ups: a decided question whose due date has arrived gets one
	//    "done?" in the channel it was asked in. Never a DM.
	const followups = await db
		.prepare(
			`SELECT * FROM quorum_questions WHERE status = 'closed' AND result IN ('yes', 'no')
			 AND followup_status IS NULL AND due_at <= ?`
		)
		.bind(nowIso)
		.all();
	for (const q of followups?.results || []) {
		try {
			const posted = await discord?.channels.send(q.channel_id, buildFollowupMessage(q));
			await db
				.prepare(
					`UPDATE quorum_questions SET followup_status = 'asked', followup_asked_at = ?, followup_message_id = ? WHERE id = ?`
				)
				.bind(nowIso, posted?.id ?? null, q.id)
				.run();
			summary.nudged++;
		} catch (err) {
			summary.failed++;
			log.error(`[Quorum] Follow-up failed for #${q.id}: ${err?.message}`);
		}
	}

	// 4. A nudge nobody answered goes stale.
	const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
	const stale = await db
		.prepare(
			`SELECT * FROM quorum_questions WHERE followup_status = 'asked' AND followup_asked_at <= ?`
		)
		.bind(staleBefore)
		.all();
	for (const q of stale?.results || []) {
		await setFollowup(db, discord, q, 'stale');
		summary.staled++;
	}

	if (summary.closed || summary.nudged || summary.failed) {
		log.info(
			`[Quorum] Sweep: ${summary.closed} closed, ${summary.reminded} reminded, ${summary.nudged} nudged, ${summary.staled} stale, ${summary.failed} failed`
		);
	}
	return summary;
}

async function setFollowup(db, discord, q: Question, status: 'done' | 'stale') {
	await db
		.prepare(`UPDATE quorum_questions SET followup_status = ? WHERE id = ?`)
		.bind(status, q.id)
		.run();
	q.followup_status = status;
	if (discord && q.followup_message_id) {
		await discord.channels
			.editMessage(q.channel_id, q.followup_message_id, buildFollowupMessage(q, status))
			.catch(() => {});
	}
}

// --- interactions ------------------------------------------------------------

type Interaction = Record<string, any>;

/** What the route sends back, plus work it should keep alive after replying. */
export interface QuorumReply {
	response: Record<string, any>;
	after?: Promise<unknown>;
}

async function isGuildOwner(discord, guildId: string, userId: string): Promise<boolean> {
	try {
		const guild = await discord?.guilds.fetch(guildId);
		return Boolean(guild?.owner_id) && guild.owner_id === userId;
	} catch {
		return false;
	}
}

function optionMap(data: any) {
	const { leaves, subcommand } = flattenInteractionOptions(data);
	const opts: Record<string, any> = {};
	for (const leaf of leaves) opts[leaf.name] = leaf.value;
	return { opts, subcommand };
}

/**
 * `/quorum …`. Returns the interaction response and, for `ask`, the work that
 * stores the posted message's id and pins it.
 */
export async function handleQuorumCommand(body: Interaction, db, discord): Promise<QuorumReply> {
	const guildId = body.guild_id;
	const channelId = body.channel_id;
	const userId = body.member?.user?.id || body.user?.id;
	const perms = body.member?.permissions;
	if (!guildId || !channelId || !userId) {
		return { response: ephemeral('Quorum only works inside a server channel.') };
	}
	if (!db) return { response: ephemeral('The database is not available right now.') };

	const { opts, subcommand } = optionMap(body.data);

	switch (subcommand) {
		case 'ask':
			return ask(body, db, discord, opts, { guildId, channelId, userId });
		case 'close': {
			const q = opts.id
				? await getQuestion(db, Number(opts.id))
				: await latestOpenInChannel(db, guildId, channelId);
			if (!q || q.guild_id !== guildId)
				return { response: ephemeral('No such question here.') };
			if (q.status !== 'open')
				return { response: ephemeral(`Question #${q.id} is already closed.`) };
			if (q.asker_id !== userId && !isCrew(perms)) {
				return {
					response: ephemeral('Only the asker or Crew can close a question early.'),
				};
			}
			const closed = await closeQuestion(db, discord, q, { reason: 'early', by: userId });
			return {
				response: ephemeral(
					closed
						? `Closed question #${q.id}. The result is posted.`
						: `Question #${q.id} was already closed.`
				),
			};
		}
		case 'results': {
			const q = await latestSettledInChannel(db, guildId, channelId);
			if (!q) return { response: ephemeral('No results in this channel yet.') };
			const settings = await getSettings(db, guildId, channelId);
			return {
				response: {
					type: RESPOND_MESSAGE,
					data: {
						embeds: [buildResultEmbed(q, settings)],
						allowed_mentions: { parse: [] },
					},
				},
			};
		}
		case 'log': {
			const rows = await listLog(db, guildId);
			return {
				response: {
					type: RESPOND_MESSAGE,
					data: {
						embeds: [buildLogEmbed(rows)],
						allowed_mentions: { parse: [] },
						flags: EPHEMERAL,
					},
				},
			};
		}
		case 'veto': {
			if (!(await isGuildOwner(discord, guildId, userId))) {
				return { response: ephemeral('Only the server owner can veto a decision.') };
			}
			const q = await getQuestion(db, Number(opts.id));
			if (!q || q.guild_id !== guildId) return { response: ephemeral('No such question.') };
			if (q.status === 'vetoed')
				return { response: ephemeral(`#${q.id} is already vetoed.`) };
			const reason = String(opts.reason || '').trim();
			if (!reason) return { response: ephemeral('A veto needs a reason — one line of why.') };
			if (q.status === 'open')
				await closeQuestion(db, discord, q, { reason: 'early', by: userId });
			await db
				.prepare(
					`UPDATE quorum_questions SET status = 'vetoed', veto_reason = ?, vetoed_at = ?, followup_status = NULL WHERE id = ?`
				)
				.bind(reason, new Date().toISOString(), q.id)
				.run();
			const vetoed = (await getQuestion(db, q.id)) as Question;
			const settings = await getSettings(db, guildId, vetoed.channel_id);
			// Public and reasoned, on the result, in the channel it was decided in.
			return {
				response: {
					type: RESPOND_MESSAGE,
					data: {
						content: `⛔ **Vetoed** by the server owner — ${reason}`,
						embeds: [buildResultEmbed(vetoed, settings)],
						allowed_mentions: { parse: [] },
						...(vetoed.result_message_id && vetoed.channel_id === channelId
							? {
									message_reference: {
										message_id: vetoed.result_message_id,
										fail_if_not_exists: false,
									},
								}
							: {}),
					},
				},
			};
		}
		case 'settings':
			return settingsCommand(db, discord, opts, { guildId, channelId, userId, perms });
		default:
			return { response: ephemeral('Unknown /quorum subcommand.') };
	}
}

async function ask(
	body: Interaction,
	db,
	discord,
	opts: Record<string, any>,
	ctx: { guildId: string; channelId: string; userId: string }
): Promise<QuorumReply> {
	const settings = await getSettings(db, ctx.guildId, ctx.channelId);
	const question = String(opts.question || '').trim();
	if (!question) return { response: ephemeral('Ask a question that can be answered yes or no.') };

	const cls = opts.class ? String(opts.class) : null;
	if (cls && cls !== 'general' && settings.protected_classes.includes(cls)) {
		return {
			response: ephemeral(
				`That is an owner decision (${cls}), not one Quorum opens. Take it to the server owner.`
			),
		};
	}

	let closesMinutes = settings.closes_minutes;
	if (opts.closes !== undefined && opts.closes !== null && String(opts.closes).trim() !== '') {
		const parsed = parseDuration(opts.closes);
		if (parsed === null) {
			return { response: ephemeral('`closes` looks like 24h, 90m or 2d.') };
		}
		closesMinutes = parsed;
	}
	if (closesMinutes < MIN_CLOSES_MINUTES || closesMinutes > MAX_CLOSES_MINUTES) {
		return {
			response: ephemeral(
				`A question stays open between ${formatDuration(MIN_CLOSES_MINUTES)} and ${formatDuration(MAX_CLOSES_MINUTES)}.`
			),
		};
	}

	let dueMinutes = DEFAULTS.dueMinutes;
	if (opts.due !== undefined && opts.due !== null && String(opts.due).trim() !== '') {
		const parsed = parseDuration(opts.due);
		if (parsed === null || parsed < 60) {
			return { response: ephemeral('`due` looks like 7d or 48h, and is at least an hour.') };
		}
		dueMinutes = parsed;
	}

	const quorum = opts.quorum ? Number(opts.quorum) : settings.quorum;
	if (!Number.isInteger(quorum) || quorum < 1) {
		return { response: ephemeral('`quorum` is a whole number of votes, at least 1.') };
	}

	// `owner` is a MENTIONABLE option: the id is a user's or a role's, and the
	// resolved map says which. A decision with no owner is a wish, so the
	// asker owns it by default.
	let ownerKind: 'user' | 'role' = 'user';
	let ownerId = ctx.userId;
	if (opts.owner) {
		ownerId = String(opts.owner);
		ownerKind = body.data?.resolved?.roles?.[ownerId] ? 'role' : 'user';
	}

	// `then` is the one thing here that makes the bot change the server by itself,
	// so it is held to the permission the change needs: the asker must be able to
	// create channels themselves.
	let auto: { action: AutoAction; name: string; threshold: number } | null = null;
	if (opts.then) {
		if (!AUTO_ACTIONS.includes(opts.then)) {
			return { response: ephemeral('Unknown `then` action.') };
		}
		if (!canManageChannels(body.member?.permissions)) {
			return {
				response: ephemeral(
					'You need Manage Channels to attach an automatic action to a question.'
				),
			};
		}
		const name = String(opts.name || '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!name) return { response: ephemeral('Say what to call the channel with `name`.') };
		const threshold =
			opts.if_yes === undefined || opts.if_yes === null
				? DEFAULT_AUTO_THRESHOLD
				: Number(opts.if_yes);
		if (!Number.isInteger(threshold) || threshold < 51 || threshold > 100) {
			return { response: ephemeral('`if_yes` is a whole percent from 51 to 100.') };
		}
		auto = { action: opts.then, name, threshold };
	} else if (opts.name || opts.if_yes) {
		return { response: ephemeral('`name` and `if_yes` only go with `then`.') };
	}

	const q = await createQuestion(db, {
		guild_id: ctx.guildId,
		channel_id: ctx.channelId,
		asker_id: ctx.userId,
		question,
		class: cls,
		quorum,
		closes_minutes: closesMinutes,
		due_minutes: dueMinutes,
		owner_kind: ownerKind,
		owner_id: ownerId,
		auto,
	});

	// The card is the interaction's own reply, so the channel shows who asked.
	// Its message id only exists once Discord has posted it, so the pin runs
	// after the reply goes back, via the webhook's @original lookup.
	const after = (async () => {
		try {
			const res = await fetch(
				`https://discord.com/api/v10/webhooks/${body.application_id}/${body.token}/messages/@original`
			);
			if (!res.ok) throw new Error(`@original ${res.status}`);
			const msg = await res.json();
			if (msg?.id) {
				await setQuestionMessage(db, q.id, msg.id);
				await discord?.channels
					.pin(ctx.channelId, msg.id, `Quorum question #${q.id}`)
					.catch((err) => log.warn(`[Quorum] Could not pin #${q.id}: ${err?.message}`));
			}
		} catch (err) {
			log.warn(`[Quorum] Could not resolve the card for #${q.id}: ${err?.message}`);
		}
	})();

	return {
		response: {
			type: RESPOND_MESSAGE,
			data: {
				embeds: [buildQuestionEmbed(q)],
				components: buildQuestionComponents(q),
				allowed_mentions: { parse: [] },
			},
		},
		after,
	};
}

async function settingsCommand(
	db,
	discord,
	opts: Record<string, any>,
	ctx: { guildId: string; channelId: string; userId: string; perms: unknown }
): Promise<QuorumReply> {
	if (!isCrew(ctx.perms)) return { response: ephemeral('Quorum settings are Crew only.') };
	const current = await getSettings(db, ctx.guildId, ctx.channelId);

	const channelPatch: Record<string, any> = {};
	const guildPatch: Record<string, any> = {};

	if (opts.closes !== undefined) {
		const parsed = parseDuration(opts.closes);
		if (parsed === null || parsed < MIN_CLOSES_MINUTES || parsed > MAX_CLOSES_MINUTES) {
			return {
				response: ephemeral('`closes` looks like 24h, 90m or 2d, between 5m and 14d.'),
			};
		}
		channelPatch.closes_minutes = parsed;
	}
	if (opts.quorum !== undefined) channelPatch.quorum = Number(opts.quorum);
	if (opts.footer !== undefined) guildPatch.footer_text = String(opts.footer).trim() || null;
	if (opts.announce !== undefined) guildPatch.announce_channel_id = String(opts.announce);

	if (opts.protect !== undefined || opts.lock !== undefined) {
		const owner = await isGuildOwner(discord, ctx.guildId, ctx.userId);
		if (opts.lock !== undefined) {
			if (!owner)
				return {
					response: ephemeral(
						'Only the server owner can lock or unlock the protected list.'
					),
				};
			guildPatch.classes_locked = Boolean(opts.lock);
		}
		if (opts.protect !== undefined) {
			if (current.classes_locked && !owner) {
				return { response: ephemeral('The protected list is locked by the server owner.') };
			}
			const raw = String(opts.protect).trim().toLowerCase();
			const list =
				raw === 'none' || raw === ''
					? []
					: raw
							.split(/[,\s]+/)
							.map((c) => c.trim())
							.filter(Boolean);
			const bad = list.filter((c) => !CLASSES.includes(c as any) || c === 'general');
			if (bad.length) {
				return {
					response: ephemeral(
						`Unknown class${bad.length > 1 ? 'es' : ''}: ${bad.join(', ')}. Choose from owner-only, money, access, legal, or none.`
					),
				};
			}
			guildPatch.protected_classes = [...new Set(list)];
		}
	}

	if (Object.keys(channelPatch).length)
		await upsertSettings(db, ctx.guildId, ctx.channelId, channelPatch);
	if (Object.keys(guildPatch).length) await upsertSettings(db, ctx.guildId, '', guildPatch);

	const s = await getSettings(db, ctx.guildId, ctx.channelId);
	const lines = [
		`**This channel** — closes after ${formatDuration(s.closes_minutes)}, quorum ${s.quorum}`,
		`**Server** — footer "${s.footer_text}"; results mirrored to ${s.announce_channel_id ? `<#${s.announce_channel_id}>` : 'nowhere'}`,
		`**Protected classes** — ${s.protected_classes.length ? s.protected_classes.join(', ') : 'none'}${s.classes_locked ? ' (locked by the owner)' : ''}`,
	];
	return { response: ephemeral(lines.join('\n')) };
}

/** A press on one of Quorum's buttons. */
export async function handleQuorumComponent(
	body: Interaction,
	db,
	_discord?
): Promise<QuorumReply> {
	const customId = String(body.data?.custom_id || '');
	const [, kind, idText, arg] = customId.split(':');
	const id = Number(idText);
	const userId = body.member?.user?.id || body.user?.id;
	if (!db || !Number.isInteger(id) || !userId)
		return { response: ephemeral('That button has expired.') };

	const q = await getQuestion(db, id);
	if (!q) return { response: ephemeral('That question is gone.') };

	if (kind === 'vote') {
		if (!CHOICES.includes(arg as Choice)) return { response: ephemeral('Unknown choice.') };
		if (q.status !== 'open') {
			return { response: ephemeral('Voting has closed on that one.') };
		}
		const fresh = await castVote(db, q, userId, arg as Choice);
		if (!fresh) return { response: ephemeral('Voting has closed on that one.') };
		return {
			response: {
				type: RESPOND_UPDATE,
				data: {
					embeds: [buildQuestionEmbed(fresh)],
					components: buildQuestionComponents(fresh),
					allowed_mentions: { parse: [] },
				},
			},
		};
	}

	if (kind === 'remind') {
		if (q.status !== 'open')
			return { response: ephemeral('That question has already closed.') };
		if (q.reminded_at)
			return { response: ephemeral('The reminders for that one have already gone out.') };
		await addReminder(db, q.id, userId);
		return {
			response: ephemeral(
				`You will get a DM about **${q.question}** ${formatDuration(REMIND_BEFORE_MS / 60000)} before it closes.`
			),
		};
	}

	if (kind === 'followup') {
		if (q.followup_status !== 'asked')
			return { response: ephemeral('That follow-up is already settled.') };
		const allowed =
			isCrew(body.member?.permissions) ||
			(q.owner_kind === 'user' && q.owner_id === userId) ||
			(q.owner_kind === 'role' &&
				Array.isArray(body.member?.roles) &&
				body.member.roles.includes(q.owner_id));
		if (!allowed)
			return {
				response: ephemeral('Only the owner of that decision, or Crew, can answer this.'),
			};
		const status = arg === 'done' ? 'done' : 'stale';
		await db
			.prepare(`UPDATE quorum_questions SET followup_status = ? WHERE id = ?`)
			.bind(status, q.id)
			.run();
		q.followup_status = status;
		return { response: { type: RESPOND_UPDATE, data: buildFollowupMessage(q, status) } };
	}

	return { response: ephemeral('Unknown button.') };
}
