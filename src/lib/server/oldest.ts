/**
 * /oldest — who has been on Discord (or in this server) the longest.
 *
 * Account age costs no API call: a Discord snowflake is a timestamp, the top 42
 * bits of the user id. The roster is `guild_members_cache`, which the scheduled
 * workflows already keep fresh, so the answer is one query over a table that is
 * already there. See docs/oldest.md.
 *
 * The trap is that `user_id` is TEXT and ids grew from 17 digits to 19. Sorted as
 * text, the newest accounts come first. Every ordering here goes through
 * CAST(user_id AS INTEGER), which fits SQLite's signed 64 bits with room to spare.
 *
 * D1 only, no discord.js: the interactions route calls this on the edge.
 */

import { RESPOND_MESSAGE } from './timebox.js';

const DISCORD_EPOCH_MS = 1420070400000n;
const EPHEMERAL = 64;
/** Rows shown. */
export const TOP_N = 10;

export type Mode = 'account' | 'newest' | 'members';

/** When the account behind a snowflake was created, or null if it is not one. */
export function snowflakeToDate(userId: string): Date | null {
	if (!/^\d{15,20}$/.test(String(userId))) return null;
	return new Date(Number((BigInt(userId) >> 22n) + DISCORD_EPOCH_MS));
}

/** "11 years 6 months", "3 months", "9 days": whole years and months, else days. */
export function formatAge(from: Date, now: Date): string {
	let months =
		(now.getUTCFullYear() - from.getUTCFullYear()) * 12 +
		(now.getUTCMonth() - from.getUTCMonth());
	if (now.getUTCDate() < from.getUTCDate()) months -= 1;
	if (months < 1) {
		const days = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86400000));
		return `${days} day${days === 1 ? '' : 's'}`;
	}
	const years = Math.floor(months / 12);
	const rest = months % 12;
	const parts: string[] = [];
	if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
	if (rest) parts.push(`${rest} month${rest === 1 ? '' : 's'}`);
	return parts.join(' ');
}

function formatDate(d: Date): string {
	return d.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});
}

/** D1's datetime('now') has no zone; read it as UTC. */
function parseStamp(value: unknown): Date | null {
	if (!value) return null;
	const s = String(value);
	const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
	return Number.isNaN(d.getTime()) ? null : d;
}

export interface Entry {
	user_id: string;
	/** Account creation for account modes, join date for `members`. */
	since: Date;
}

export type Roster =
	| { state: 'never_synced' }
	| { state: 'refreshing' }
	| { state: 'empty' }
	| { state: 'ok'; entries: Entry[]; total: number; cachedAt: Date | null };

export async function loadRoster(db, guildId: string, mode: Mode): Promise<Roster> {
	const meta = await db
		.prepare('SELECT members_last_refreshed FROM guild_cache_metadata WHERE guild_id = ?')
		.bind(guildId)
		.first();
	const cachedAt = parseStamp(meta?.members_last_refreshed);

	// Humans only: some bot accounts are very old and would win every time.
	const joinedOnly = mode === 'members' ? ' AND joined_at IS NOT NULL' : '';
	const total =
		(
			await db
				.prepare(
					`SELECT COUNT(*) AS n FROM guild_members_cache
					 WHERE guild_id = ? AND is_bot = 0${joinedOnly}`
				)
				.bind(guildId)
				.first()
		)?.n ?? 0;

	if (total === 0) {
		// A refresh deletes the guild's rows before it inserts them, so an empty
		// table with a past refresh on record is a refresh in flight (or a server
		// of bots), and one with none on record has never been synced at all.
		return { state: cachedAt ? 'refreshing' : 'never_synced' };
	}

	const order =
		mode === 'account'
			? 'CAST(user_id AS INTEGER) ASC'
			: mode === 'newest'
				? 'CAST(user_id AS INTEGER) DESC'
				: 'joined_at ASC, CAST(user_id AS INTEGER) ASC';
	const { results } = await db
		.prepare(
			`SELECT user_id, joined_at FROM guild_members_cache
			 WHERE guild_id = ? AND is_bot = 0${joinedOnly}
			 ORDER BY ${order} LIMIT ?`
		)
		.bind(guildId, TOP_N)
		.all();

	const entries: Entry[] = [];
	for (const row of results ?? []) {
		const since = mode === 'members' ? parseStamp(row.joined_at) : snowflakeToDate(row.user_id);
		if (since) entries.push({ user_id: String(row.user_id), since });
	}
	return entries.length ? { state: 'ok', entries, total, cachedAt } : { state: 'empty' };
}

function cacheNote(cachedAt: Date | null, now: Date): string {
	if (!cachedAt) return '';
	const minutes = Math.max(0, Math.round((now.getTime() - cachedAt.getTime()) / 60000));
	const ago =
		minutes < 60
			? `${minutes} minute${minutes === 1 ? '' : 's'}`
			: minutes < 2880
				? `${Math.round(minutes / 60)} hours`
				: `${Math.round(minutes / 1440)} days`;
	return `\n-# Member list as of ${ago} ago.`;
}

export function renderRoster(roster: Roster, mode: Mode, now = new Date()): string {
	if (roster.state === 'never_synced') {
		return 'This server has not been synced yet, so there is no member list to look at. An admin can sync it from the dashboard.';
	}
	if (roster.state === 'refreshing') {
		return 'The member list is being refreshed. Try again in a moment.';
	}
	if (roster.state === 'empty') return 'There are no members to rank yet.';

	const title =
		mode === 'account'
			? 'Oldest Discord accounts here'
			: mode === 'newest'
				? 'Newest Discord accounts here'
				: 'Longest-serving members';
	const verb = mode === 'members' ? 'joined' : 'created';
	const lines = roster.entries.map(
		(e, i) =>
			`${i + 1}. <@${e.user_id}> — ${verb} ${formatDate(e.since)}, ${formatAge(e.since, now)} ago`
	);
	return `**${title}** (of ${roster.total} members)\n${lines.join('\n')}${cacheNote(roster.cachedAt, now)}`;
}

function reply(content: string, ephemeral: boolean) {
	return {
		type: RESPOND_MESSAGE,
		data: {
			content,
			allowed_mentions: { parse: [] },
			...(ephemeral ? { flags: EPHEMERAL } : {}),
		},
	};
}

export async function handleOldestCommand(body, db, now = new Date()) {
	const guildId = body.guild_id;
	if (!guildId) return reply('/oldest only works inside a server.', true);
	if (!db) return reply('The database is not available right now.', true);

	const picked = (body.data?.options ?? []).find((o) => o.name === 'show')?.value;
	const mode: Mode = picked === 'newest' || picked === 'members' ? picked : 'account';
	const roster = await loadRoster(db, guildId, mode);
	return reply(renderRoster(roster, mode, now), roster.state !== 'ok');
}
