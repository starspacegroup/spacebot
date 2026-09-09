/**
 * How each public channel is actually used.
 *
 * The channel directory (`guild-channels.ts`) says what a server *has*. This
 * says what happens in it — messages and who posted them for text channels,
 * time spent and how many people for voice — so a community site can tell a
 * newcomer which rooms are alive and when to show up, instead of printing a
 * list of names and a topic somebody set in 2023 and forgot.
 *
 * Everything here is a **count**. No message text, no member names, no ids of
 * who did what. The `event_logs` firehose holds all of that, and none of it
 * leaves this module: the queries aggregate before returning, so the caller
 * cannot publish what it was never given. That is deliberate — this feeds a
 * public page.
 *
 * Two sources, both already written by the gateway:
 *
 * - `event_logs`, `event_type = 'MESSAGE_CREATE'`, grouped by channel. Raw
 *   events are pruned at 90 days (`event-log-retention.ts`), which is the hard
 *   ceiling on the window: a longer request is clamped to
 *   {@link MAX_ACTIVITY_DAYS} and the response says which window it answered,
 *   so nobody labels 90 days of data as a year.
 * - `voice_sessions`, one row per join, with `duration_seconds` filled in on
 *   leave. A session still open contributes to the head count but not to the
 *   time, because its length is not known yet.
 *
 * **A channel excluded from logging reports `null`, not zero.** `guild_settings.
 * excluded_channels` is an admin's decision not to record a room; the events
 * were never written, so "0 messages" would be a lie about a channel that may
 * be the busiest one there. Unknown and empty are different answers and this
 * module keeps them apart.
 */

import { log } from './logger.js';

/** Raw events are pruned at 90 days, so nothing older can be counted. */
export const MAX_ACTIVITY_DAYS = 90;

/** What a caller gets when it does not ask for a window. */
export const DEFAULT_ACTIVITY_DAYS = 30;

/** How one channel was used over the window. */
export type ChannelActivity = {
	/** Messages posted. Null when the channel is excluded from logging. */
	messages: number | null;
	/** Distinct people who posted. Null for the same reason. */
	posters: number | null;
	/** ISO-ish timestamp of the most recent message, or null. */
	lastMessageAt: string | null;
	/** Completed voice time, in seconds. */
	voiceSeconds: number;
	/** Distinct people who joined voice. */
	voicePeople: number;
	/** Times somebody joined. */
	voiceSessions: number;
	/** Mean length of a completed visit, in seconds, or null if none completed. */
	typicalStaySeconds: number | null;
	/** Hour of day (0-23, UTC) this channel is joined most often, or null. */
	busiestHourUtc: number | null;
	/** Most recent voice join, or null. */
	lastVoiceAt: string | null;
	/** Joining this channel makes the member a room of their own. */
	lobby: boolean;
};

export type ChannelActivityReport = {
	/** Window actually used, in days. */
	days: number;
	/** The guild's own timezone, for rendering {@link ChannelActivity.busiestHourUtc}. */
	timezone: string | null;
	/** Keyed by channel id. A channel with no activity at all is still present. */
	channels: Record<string, ChannelActivity>;
};

const EMPTY = (lobby: boolean): ChannelActivity => ({
	messages: 0,
	posters: 0,
	lastMessageAt: null,
	voiceSeconds: 0,
	voicePeople: 0,
	voiceSessions: 0,
	typicalStaySeconds: null,
	busiestHourUtc: null,
	lastVoiceAt: null,
	lobby,
});

const int = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

const text = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
};

/**
 * Clamp a caller's `days` to something the data can answer.
 *
 * A missing or unparseable value means the default. Anything above
 * {@link MAX_ACTIVITY_DAYS} is clamped rather than rejected — the caller gets
 * the longest honest answer, and the report carries the window it used.
 */
export function normalizeActivityDays(raw: unknown): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_ACTIVITY_DAYS;
	const whole = Math.floor(parsed);
	if (whole < 1) return 1;
	if (whole > MAX_ACTIVITY_DAYS) return MAX_ACTIVITY_DAYS;
	return whole;
}

/**
 * Read every public channel's activity over the last `days`.
 *
 * Four bounded queries, each keyed on `(guild_id, <time column>)` so none of
 * them scans the firehose whole — the 2026-08-03 logs-page incident was exactly
 * that mistake, and this endpoint is meant to be cached for a day by whoever
 * asks, not polled.
 *
 * @param channelIds the channels to report on. Anything not listed is ignored,
 *   so a room a member made cannot appear in the answer even if it has events.
 */
export async function getChannelActivity(
	db: any,
	guildId: string,
	channelIds: string[],
	days: number = DEFAULT_ACTIVITY_DAYS
): Promise<ChannelActivityReport> {
	const window = normalizeActivityDays(days);
	const report: ChannelActivityReport = { days: window, timezone: null, channels: {} };
	if (!db || !guildId || !channelIds.length) return report;

	const wanted = new Set(channelIds.map(String));
	const since = `-${window} days`;

	let excluded = new Set<string>();
	let lobbies = new Set<string>();

	try {
		const settings = await db
			.prepare('SELECT excluded_channels, timezone FROM guild_settings WHERE guild_id = ?')
			.bind(guildId)
			.first();
		report.timezone = text(settings?.timezone);
		if (settings?.excluded_channels) {
			try {
				const parsed = JSON.parse(String(settings.excluded_channels));
				if (Array.isArray(parsed)) excluded = new Set(parsed.map(String));
			} catch {
				// A malformed exclusion list is not a reason to report nothing. It is
				// also not a reason to assume nothing is excluded, but the alternative
				// — hiding every channel — is worse, and the list is admin-written.
			}
		}
	} catch (error) {
		log.error('[ChannelActivity] Failed to read guild settings:', error);
	}

	try {
		const rows = await db
			.prepare(
				`SELECT lobby_channel_id FROM channel_presets
         WHERE guild_id = ? AND enabled = 1 AND lobby_channel_id IS NOT NULL`
			)
			.bind(guildId)
			.all();
		lobbies = new Set((rows?.results || []).map((row: any) => String(row.lobby_channel_id)));
	} catch (error) {
		log.error('[ChannelActivity] Failed to read lobby channels:', error);
	}

	for (const id of wanted) report.channels[id] = EMPTY(lobbies.has(id));

	// A channel nobody records is unknown, not silent.
	for (const id of excluded) {
		const entry = report.channels[id];
		if (!entry) continue;
		entry.messages = null;
		entry.posters = null;
	}

	try {
		const messages = await db
			.prepare(
				`SELECT channel_id,
                COUNT(*) AS messages,
                COUNT(DISTINCT actor_id) AS posters,
                MAX(created_at) AS last_at
         FROM event_logs
         WHERE guild_id = ?
           AND created_at >= datetime('now', ?)
           AND event_type = 'MESSAGE_CREATE'
           AND channel_id IS NOT NULL
         GROUP BY channel_id`
			)
			.bind(guildId, since)
			.all();

		for (const row of messages?.results || []) {
			const id = String((row as any).channel_id);
			const entry = report.channels[id];
			// Excluded channels keep their null. An event predating the exclusion
			// must not turn "not recorded" back into a number.
			if (!entry || excluded.has(id)) continue;
			entry.messages = int((row as any).messages);
			entry.posters = int((row as any).posters);
			entry.lastMessageAt = text((row as any).last_at);
		}
	} catch (error) {
		log.error('[ChannelActivity] Failed to read message activity:', error);
	}

	try {
		const voice = await db
			.prepare(
				`SELECT channel_id,
                COUNT(*) AS sessions,
                COUNT(DISTINCT user_id) AS people,
                COALESCE(SUM(duration_seconds), 0) AS seconds,
                AVG(duration_seconds) AS typical,
                MAX(joined_at) AS last_at
         FROM voice_sessions
         WHERE guild_id = ?
           AND joined_at >= datetime('now', ?)
         GROUP BY channel_id`
			)
			.bind(guildId, since)
			.all();

		for (const row of voice?.results || []) {
			const entry = report.channels[String((row as any).channel_id)];
			if (!entry) continue;
			entry.voiceSessions = int((row as any).sessions);
			entry.voicePeople = int((row as any).people);
			entry.voiceSeconds = int((row as any).seconds);
			const typical = (row as any).typical;
			entry.typicalStaySeconds =
				typical === null || typical === undefined ? null : int(typical);
			entry.lastVoiceAt = text((row as any).last_at);
		}
	} catch (error) {
		log.error('[ChannelActivity] Failed to read voice activity:', error);
	}

	try {
		// When a channel is busy, as an hour of the day. Grouped in SQL and
		// reduced to one winner per channel here, because SQLite has no idiomatic
		// argmax and the result set is at most 24 rows per voice channel.
		const hours = await db
			.prepare(
				`SELECT channel_id,
                CAST(strftime('%H', joined_at) AS INTEGER) AS hour,
                COUNT(*) AS joins
         FROM voice_sessions
         WHERE guild_id = ?
           AND joined_at >= datetime('now', ?)
         GROUP BY channel_id, hour`
			)
			.bind(guildId, since)
			.all();

		const best: Record<string, { hour: number; joins: number }> = {};
		for (const row of hours?.results || []) {
			const id = String((row as any).channel_id);
			const hour = int((row as any).hour);
			const joins = int((row as any).joins);
			if (!report.channels[id]) continue;
			if (!best[id] || joins > best[id].joins) best[id] = { hour, joins };
		}
		for (const [id, winner] of Object.entries(best)) {
			report.channels[id].busiestHourUtc = winner.hour;
		}
	} catch (error) {
		log.error('[ChannelActivity] Failed to read voice hours:', error);
	}

	return report;
}
