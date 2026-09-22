/**
 * What one member did in this server — their own figures, and nobody else's.
 *
 * `channel-activity.ts` answers "which rooms are alive" for a public page.
 * This answers "what have *I* done here", for a site that has already proved,
 * through Discord OAuth, that the person asking owns the account being asked
 * about. The two modules keep the same discipline: **counts only**. No message
 * text, no channel ids, no member names, no ids of anyone else. A caller can
 * publish nothing it was never given.
 *
 * Three sources, all already written by the gateway:
 *
 * - `guild_members_cache` — is this account in the server right now, and since
 *   when. The gateway keeps it in step with `GUILD_MEMBER_ADD`/`REMOVE`, so
 *   this is the membership answer, not a guess from old activity. A member who
 *   left has rows in `event_logs` for months afterwards; only the cache knows
 *   they are gone.
 * - `event_logs`, `event_type = 'MESSAGE_CREATE'`, `actor_id = <user>`. Pruned
 *   at 90 days (`event-log-retention.ts`), which is the hard ceiling on every
 *   window here.
 * - `voice_sessions` and `command_logs`, keyed by `user_id`.
 *
 * **A channel the server excludes from logging is not counted, and the answer
 * says how many there are.** `guild_settings.excluded_channels` is an admin's
 * decision not to record a room. Those events were never written, so a total
 * that silently omits them would read as "you have posted less than you have".
 * `unrecorded_channels` is what lets the caller say so out loud.
 */

import { log } from './logger.js';

/** Raw events are pruned at 90 days, so nothing older can be counted. */
export const RETENTION_DAYS = 90;

/** What a caller gets when it does not ask for a window. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Counts over one window. Every field is a number this server recorded. */
export type MemberWindow = {
	/** Messages posted in channels this server records. */
	messages: number;
	/** Distinct recorded channels posted in. */
	channels: number;
	/** When the most recent recorded message landed, or null. */
	lastMessageAt: string | null;
	/** Completed voice time, in seconds. A session still open is not counted. */
	voiceSeconds: number;
	/** Times they joined a voice channel. */
	voiceSessions: number;
	/** Distinct voice channels joined. */
	voiceChannels: number;
	/** Most recent voice join, or null. */
	lastVoiceAt: string | null;
	/** Slash commands run. */
	commands: number;
};

/**
 * Where they stand among the people who did the same thing in the window.
 *
 * `rank` is 1 for the most active. `population` is how many people did it at
 * all, so the caller can say "4th of 37" rather than a bare number that means
 * nothing without the field size. Both are null when the member did none of
 * that thing — there is no rank among people you are not one of.
 *
 * Still counts only: this says how many people are ahead, never who.
 */
export type MemberStanding = {
	messageRank: number | null;
	messagePopulation: number;
	voiceRank: number | null;
	voicePopulation: number;
};

export type MemberActivity = {
	/** In the server right now, per the gateway's member cache. */
	member: boolean;
	/** When they joined, or null when the cache never learned it. */
	joinedAt: string | null;
	/** True when the account is a bot. */
	bot: boolean;
	/** The window `activity` covers, in days. */
	days: number;
	/** The ceiling on every window — how far back events are kept at all. */
	retentionDays: number;
	/** Counts over the last `days`. */
	activity: MemberWindow;
	/** Counts over everything still retained, i.e. {@link RETENTION_DAYS}. */
	recorded: MemberWindow;
	/** Standing over the last `days`. */
	standing: MemberStanding;
	/** Public channels this server does not log, so none of the above counts them. */
	unrecordedChannels: number;
};

const int = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

const text = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
};

const EMPTY_WINDOW = (): MemberWindow => ({
	messages: 0,
	channels: 0,
	lastMessageAt: null,
	voiceSeconds: 0,
	voiceSessions: 0,
	voiceChannels: 0,
	lastVoiceAt: null,
	commands: 0,
});

const EMPTY_STANDING = (): MemberStanding => ({
	messageRank: null,
	messagePopulation: 0,
	voiceRank: null,
	voicePopulation: 0,
});

/**
 * Clamp a caller's `days` to something the data can answer.
 *
 * Anything above {@link RETENTION_DAYS} is clamped rather than refused — the
 * caller gets the longest honest answer, and the response carries the window it
 * actually used, the same contract `normalizeActivityDays` keeps.
 */
export function normalizeWindowDays(raw: unknown): number {
	// `Number(null)` is 0, and `Number('')` is 0 — both would clamp to a
	// one-day window rather than the default. A query parameter that was never
	// sent arrives as exactly that null, so "absent" is checked before "0".
	if (raw === null || raw === undefined || raw === '') return DEFAULT_WINDOW_DAYS;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_DAYS;
	const whole = Math.floor(parsed);
	if (whole < 1) return 1;
	if (whole > RETENTION_DAYS) return RETENTION_DAYS;
	return whole;
}

/** The channels an admin chose not to record, as a set of ids. */
async function readExcludedChannels(db: any, guildId: string): Promise<Set<string>> {
	try {
		const settings = await db
			.prepare('SELECT excluded_channels FROM guild_settings WHERE guild_id = ?')
			.bind(guildId)
			.first();
		if (!settings?.excluded_channels) return new Set();
		const parsed = JSON.parse(String(settings.excluded_channels));
		return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
	} catch (error) {
		// A malformed list is not a reason to report nothing, and not a reason to
		// claim nothing is excluded either. The count below simply reads 0, and
		// the message totals stay as recorded — the same call `channel-activity`
		// makes, for the same reason.
		log.error('[MemberActivity] Failed to read excluded channels:', error);
		return new Set();
	}
}

/**
 * Build the `NOT IN (?, ?, …)` fragment for a set of excluded channels.
 *
 * Interpolating ids straight into SQL would be the one place this module could
 * take a string from a settings row into a statement, so it does not: the
 * fragment is placeholders only, and the ids ride in as bindings.
 */
function exclusionClause(excluded: Set<string>): { sql: string; binds: string[] } {
	if (excluded.size === 0) return { sql: '', binds: [] };
	const binds = [...excluded];
	return {
		sql: ` AND (channel_id IS NULL OR channel_id NOT IN (${binds.map(() => '?').join(', ')}))`,
		binds,
	};
}

/** One window's counts for one member. Each read fails to zero on its own. */
async function readWindow(
	db: any,
	guildId: string,
	userId: string,
	days: number,
	excluded: Set<string>
): Promise<MemberWindow> {
	const window = EMPTY_WINDOW();
	const since = `-${days} days`;
	const { sql: notExcluded, binds: excludedBinds } = exclusionClause(excluded);

	try {
		const row = await db
			.prepare(
				`SELECT COUNT(*) AS messages,
                COUNT(DISTINCT channel_id) AS channels,
                MAX(created_at) AS last_at
         FROM event_logs
         WHERE guild_id = ?
           AND actor_id = ?
           AND created_at >= datetime('now', ?)
           AND event_type = 'MESSAGE_CREATE'${notExcluded}`
			)
			.bind(guildId, userId, since, ...excludedBinds)
			.first();
		window.messages = int(row?.messages);
		window.channels = int(row?.channels);
		window.lastMessageAt = text(row?.last_at);
	} catch (error) {
		log.error('[MemberActivity] Failed to read message activity:', error);
	}

	try {
		const row = await db
			.prepare(
				`SELECT COUNT(*) AS sessions,
                COUNT(DISTINCT channel_id) AS channels,
                COALESCE(SUM(duration_seconds), 0) AS seconds,
                MAX(joined_at) AS last_at
         FROM voice_sessions
         WHERE guild_id = ?
           AND user_id = ?
           AND joined_at >= datetime('now', ?)`
			)
			.bind(guildId, userId, since)
			.first();
		window.voiceSessions = int(row?.sessions);
		window.voiceChannels = int(row?.channels);
		window.voiceSeconds = int(row?.seconds);
		window.lastVoiceAt = text(row?.last_at);
	} catch (error) {
		log.error('[MemberActivity] Failed to read voice activity:', error);
	}

	try {
		const row = await db
			.prepare(
				`SELECT COUNT(*) AS commands
         FROM command_logs
         WHERE guild_id = ?
           AND user_id = ?
           AND created_at >= datetime('now', ?)`
			)
			.bind(guildId, userId, since)
			.first();
		window.commands = int(row?.commands);
	} catch (error) {
		log.error('[MemberActivity] Failed to read command activity:', error);
	}

	return window;
}

/**
 * How many people are ahead of this member, and how many are in the field.
 *
 * Both queries group the window by actor and count the groups that scored
 * higher, which is one pass over an index-bounded slice rather than a sort of
 * the whole firehose. Bots are left in: `event_logs` does not say which actor
 * is one, and inventing a filter the data cannot support would make the rank
 * wrong in a way nobody could see. A caller that wants humans only should say
 * so, and this module would need the member cache joined in to answer it.
 */
async function readStanding(
	db: any,
	guildId: string,
	days: number,
	window: MemberWindow,
	excluded: Set<string>
): Promise<MemberStanding> {
	const standing = EMPTY_STANDING();
	const since = `-${days} days`;
	const { sql: notExcluded, binds: excludedBinds } = exclusionClause(excluded);

	try {
		const row = await db
			.prepare(
				`SELECT COUNT(*) AS population,
                SUM(CASE WHEN posts > ? THEN 1 ELSE 0 END) AS ahead
         FROM (
           SELECT actor_id, COUNT(*) AS posts
           FROM event_logs
           WHERE guild_id = ?
             AND created_at >= datetime('now', ?)
             AND event_type = 'MESSAGE_CREATE'
             AND actor_id IS NOT NULL${notExcluded}
           GROUP BY actor_id
         )`
			)
			.bind(window.messages, guildId, since, ...excludedBinds)
			.first();
		standing.messagePopulation = int(row?.population);
		// No rank for somebody who posted nothing: they are not in the field, and
		// "last of 37" would be a claim about a contest they did not enter.
		standing.messageRank = window.messages > 0 ? int(row?.ahead) + 1 : null;
	} catch (error) {
		log.error('[MemberActivity] Failed to read message standing:', error);
	}

	try {
		const row = await db
			.prepare(
				`SELECT COUNT(*) AS population,
                SUM(CASE WHEN seconds > ? THEN 1 ELSE 0 END) AS ahead
         FROM (
           SELECT user_id, COALESCE(SUM(duration_seconds), 0) AS seconds
           FROM voice_sessions
           WHERE guild_id = ?
             AND joined_at >= datetime('now', ?)
           GROUP BY user_id
         )`
			)
			.bind(window.voiceSeconds, guildId, since)
			.first();
		standing.voicePopulation = int(row?.population);
		standing.voiceRank = window.voiceSeconds > 0 ? int(row?.ahead) + 1 : null;
	} catch (error) {
		log.error('[MemberActivity] Failed to read voice standing:', error);
	}

	return standing;
}

/**
 * Everything this server recorded about one member, and whether they are still
 * in it.
 *
 * A user id with no cache row comes back `member: false` with empty counts
 * rather than an error — "not a member of this server" is an answer, and the
 * most common one this endpoint will give.
 *
 * @param days the window for `activity` and `standing`; clamped to
 *   {@link RETENTION_DAYS}.
 */
export async function getMemberActivity(
	db: any,
	guildId: string,
	userId: string,
	days: number = DEFAULT_WINDOW_DAYS
): Promise<MemberActivity> {
	const window = normalizeWindowDays(days);
	const blank: MemberActivity = {
		member: false,
		joinedAt: null,
		bot: false,
		days: window,
		retentionDays: RETENTION_DAYS,
		activity: EMPTY_WINDOW(),
		recorded: EMPTY_WINDOW(),
		standing: EMPTY_STANDING(),
		unrecordedChannels: 0,
	};

	if (!db || !guildId || !userId) return blank;

	let cached: any = null;
	try {
		cached = await db
			.prepare(
				'SELECT joined_at, is_bot FROM guild_members_cache WHERE guild_id = ? AND user_id = ?'
			)
			.bind(guildId, userId)
			.first();
	} catch (error) {
		log.error('[MemberActivity] Failed to read the member cache:', error);
	}

	// Not in the server: say so and stop. Reading somebody's history out of the
	// logs after they left is exactly the kind of thing this endpoint should not
	// be able to hand back.
	if (!cached) return blank;

	const excluded = await readExcludedChannels(db, guildId);

	const [activity, recorded] = await Promise.all([
		readWindow(db, guildId, userId, window, excluded),
		readWindow(db, guildId, userId, RETENTION_DAYS, excluded),
	]);
	const standing = await readStanding(db, guildId, window, activity, excluded);

	return {
		...blank,
		member: true,
		joinedAt: text(cached.joined_at),
		bot: Number(cached.is_bot) === 1,
		activity,
		recorded,
		standing,
		unrecordedChannels: excluded.size,
	};
}
