/**
 * Anniversary timeline dispatch.
 *
 * A guild that has turned a timeline on gets its events posted as their minutes
 * come round on the anniversary. Runs from the per-minute workflow tick, the
 * same path as scheduled messages and the room reaper.
 *
 * The two things that matter here are both about not making a mess on a day
 * where a mess would be the worst kind:
 *
 *  1. **Never twice.** The unique index on (timeline_id, year, event_key) is the
 *     lock. A row is claimed with INSERT OR IGNORE and the post only happens if
 *     the insert did, so two overlapping ticks cannot both send. SQLite decides
 *     the race, not timing.
 *  2. **Never in a burst.** An event more than `grace_minutes` late is recorded
 *     as skipped rather than posted. After an outage the channel gets a gap,
 *     which is quiet; the alternative is three hours of a memorial arriving at
 *     once, which is not.
 *
 * Content is in `$lib/anniversaries.ts` and is the same for every guild.
 */

import {
	DEFAULT_TIMELINE_KEY,
	dueEvents,
	getTimeline,
	yearsSince,
	zonedNow,
	type AnniversaryEvent,
	type AnniversaryTimeline,
} from '../anniversaries.js';
import { log } from '../log.js';

const MIN_GRACE_MINUTES = 1;
const MAX_GRACE_MINUTES = 240;

/** Settings a guild has never touched. Off, with the timeline's own defaults. */
export function defaultTimelineSettings(timelineKey = DEFAULT_TIMELINE_KEY) {
	const timeline = getTimeline(timelineKey);

	return {
		timeline_key: timelineKey,
		enabled: false,
		channel_id: null,
		timezone: timeline?.timezone ?? 'America/New_York',
		grace_minutes: 15,
		use_embed: true,
		embed_color: null,
	};
}

function rowToSettings(row) {
	return {
		id: row.id,
		guild_id: row.guild_id,
		timeline_key: row.timeline_key,
		enabled: Boolean(row.enabled),
		channel_id: row.channel_id ?? null,
		timezone: row.timezone,
		grace_minutes: row.grace_minutes,
		use_embed: Boolean(row.use_embed),
		embed_color: row.embed_color ?? null,
	};
}

export async function getAnniversarySettings(db, guildId, timelineKey = DEFAULT_TIMELINE_KEY) {
	if (!db) return defaultTimelineSettings(timelineKey);

	try {
		const row = await db
			.prepare(`SELECT * FROM anniversary_timelines WHERE guild_id = ? AND timeline_key = ?`)
			.bind(guildId, timelineKey)
			.first();

		return row ? rowToSettings(row) : defaultTimelineSettings(timelineKey);
	} catch (error) {
		log.error('[Anniversary] Failed to read settings:', error);
		return defaultTimelineSettings(timelineKey);
	}
}

/**
 * Clamp and normalise whatever the dashboard sent.
 *
 * Enabling without a channel is rejected rather than silently stored: a
 * timeline that is "on" and posts nowhere looks identical, from the dashboard,
 * to one that is working — and you would only find out on the one day it
 * mattered.
 */
export function normalizeAnniversarySettings(input, timelineKey = DEFAULT_TIMELINE_KEY) {
	const timeline = getTimeline(timelineKey);
	if (!timeline) return { ok: false, error: `Unknown timeline "${timelineKey}"` };

	const enabled = Boolean(input?.enabled);
	const channelId = String(input?.channel_id ?? '').trim() || null;

	if (enabled && !channelId) {
		return { ok: false, error: 'Pick a channel before turning the timeline on' };
	}
	if (channelId && !/^\d{17,20}$/.test(channelId)) {
		return { ok: false, error: 'That does not look like a Discord channel id' };
	}

	const timezone = String(input?.timezone ?? '').trim() || timeline.timezone;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: timezone });
	} catch {
		return { ok: false, error: `Unknown timezone "${timezone}"` };
	}

	const rawGrace = Number(input?.grace_minutes);
	const grace = Number.isFinite(rawGrace)
		? Math.min(MAX_GRACE_MINUTES, Math.max(MIN_GRACE_MINUTES, Math.round(rawGrace)))
		: 15;

	const rawColor = input?.embed_color;
	let embedColor = null;
	if (rawColor !== null && rawColor !== undefined && rawColor !== '') {
		const parsed =
			typeof rawColor === 'string'
				? parseInt(rawColor.replace(/^#/, ''), 16)
				: Number(rawColor);
		if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffffff) {
			return { ok: false, error: 'Embed colour must be a hex value like #2B2D31' };
		}
		embedColor = parsed;
	}

	return {
		ok: true,
		value: {
			timeline_key: timelineKey,
			enabled,
			channel_id: channelId,
			timezone,
			grace_minutes: grace,
			use_embed: input?.use_embed === undefined ? true : Boolean(input.use_embed),
			embed_color: embedColor,
		},
	};
}

export async function saveAnniversarySettings(
	db,
	guildId,
	input,
	timelineKey = DEFAULT_TIMELINE_KEY
) {
	const normalized = normalizeAnniversarySettings(input, timelineKey);
	if (!normalized.ok) return { success: false, error: normalized.error };

	const v = normalized.value;

	try {
		await db
			.prepare(
				`INSERT INTO anniversary_timelines
				   (guild_id, timeline_key, enabled, channel_id, timezone, grace_minutes, use_embed, embed_color)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(guild_id, timeline_key) DO UPDATE SET
				   enabled = excluded.enabled,
				   channel_id = excluded.channel_id,
				   timezone = excluded.timezone,
				   grace_minutes = excluded.grace_minutes,
				   use_embed = excluded.use_embed,
				   embed_color = excluded.embed_color,
				   updated_at = CURRENT_TIMESTAMP`
			)
			.bind(
				guildId,
				v.timeline_key,
				v.enabled ? 1 : 0,
				v.channel_id,
				v.timezone,
				v.grace_minutes,
				v.use_embed ? 1 : 0,
				v.embed_color
			)
			.run();

		return { success: true, settings: { guild_id: guildId, ...v } };
	} catch (error) {
		log.error('[Anniversary] Failed to save settings:', error);
		return { success: false, error: error.message || 'Failed to save' };
	}
}

/** Every guild with this timeline switched on and a channel to post in. */
async function getEnabledTimelines(db) {
	const result = await db
		.prepare(
			`SELECT * FROM anniversary_timelines
			 WHERE enabled = 1 AND channel_id IS NOT NULL`
		)
		.all();

	return (result.results || []).map(rowToSettings);
}

async function getPostedKeys(db, timelineId, year) {
	const result = await db
		.prepare(
			`SELECT event_key FROM anniversary_timeline_posts WHERE timeline_id = ? AND year = ?`
		)
		.bind(timelineId, year)
		.all();

	return new Set<string>((result.results || []).map((r) => String(r.event_key)));
}

/**
 * Take ownership of one event for one guild-year, or return false.
 *
 * `meta.changes` is the whole point: OR IGNORE turns the unique-index violation
 * into a no-op, and `changes === 0` means somebody else already has it.
 */
async function claimEvent(db, timelineId, year, eventKey, status = 'claimed') {
	const result = await db
		.prepare(
			`INSERT OR IGNORE INTO anniversary_timeline_posts (timeline_id, year, event_key, status)
			 VALUES (?, ?, ?, ?)`
		)
		.bind(timelineId, year, eventKey, status)
		.run();

	return (result.meta?.changes ?? 0) > 0;
}

export function buildEventMessage(
	timeline: AnniversaryTimeline,
	event: AnniversaryEvent,
	options: { year: number; useEmbed: boolean; color?: number | null }
) {
	const years = yearsSince(timeline, options.year);
	const header =
		event.opening && years ? `**${timeline.title}** — ${years} years ago today\n\n` : '';
	const stamp = event.closing ? '' : `**${formatClock(event.time)}** · `;

	if (!options.useEmbed) {
		// Discord renders a masked [text](url) link inside an embed and NOT in
		// ordinary message content, where it posts the brackets literally. So the
		// plain-text path spells the URL out, wrapped in <> — which is what
		// suppresses the auto-preview a guild turned embeds off to avoid.
		const lines = [`${header}${stamp}**${event.title}**`, event.body];
		if (event.place) {
			lines.push(`📍 ${event.place.name} — <${mapUrl(event.place.query)}>`);
		}
		if (event.image) {
			lines.push(`Photograph: <${event.image.url}> — ${event.image.credit}`);
		}

		return { content: lines.join('\n') };
	}

	// A masked link is fine here: this branch is an embed.
	const place = event.place ? `📍 [${event.place.name}](${mapUrl(event.place.query)})` : '';

	const embed: Record<string, unknown> = {
		title: event.closing ? event.title : `${formatClock(event.time)} — ${event.title}`,
		description: place ? `${event.body}\n\n${place}` : event.body,
		color: options.color ?? timeline.color,
	};

	if (event.image) {
		embed.image = { url: event.image.url };
	}

	// Every post says which day it belongs to. These arrive hours apart and
	// land between whatever else the channel was talking about, so a post that
	// only says "9:59 AM — The South Tower falls" leaves a reader who scrolled
	// in to work out what they are looking at. The footer also carries the
	// photo credit, which the licence requires wherever the photo appears.
	const footer = [timeline.title, event.image?.credit].filter(Boolean).join(' · ');
	embed.footer = { text: footer };

	if (event.opening && years) {
		embed.author = { name: `${timeline.title} · ${years} years ago today` };
	}

	return { embeds: [embed] };
}

/**
 * A Google Maps link for a place.
 *
 * `query` is already either a `lat,lon` pair or a place name (see
 * `AnniversaryEvent.place`); both are valid input to the Maps URL API, which
 * is the documented, stable form rather than a scraped one.
 */
export function mapUrl(query: string): string {
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** "08:46" → "8:46 AM". The clock people remember, not the one we store. */
export function formatClock(time: string): string {
	const [h, m] = String(time).split(':').map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return time;

	const suffix = h < 12 ? 'AM' : 'PM';
	const hour12 = h % 12 === 0 ? 12 : h % 12;

	return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

async function postToChannel(botToken, channelId, body) {
	const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
		method: 'POST',
		headers: {
			Authorization: `Bot ${botToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Discord API error ${response.status}: ${text}`);
	}

	return await response.json();
}

async function markSent(db, timelineId, year, eventKey, messageId) {
	await db
		.prepare(
			`UPDATE anniversary_timeline_posts
			 SET status = 'sent', message_id = ?, sent_at = CURRENT_TIMESTAMP
			 WHERE timeline_id = ? AND year = ? AND event_key = ?`
		)
		.bind(messageId ?? null, timelineId, year, eventKey)
		.run();
}

async function markFailed(db, timelineId, year, eventKey, error) {
	await db
		.prepare(
			`UPDATE anniversary_timeline_posts
			 SET status = 'failed', error = ?
			 WHERE timeline_id = ? AND year = ? AND event_key = ?`
		)
		.bind(String(error).slice(0, 500), timelineId, year, eventKey)
		.run();
}

/**
 * One tick. Cheap on 364 days a year: one indexed read that returns nothing.
 */
export async function processAnniversaryTimelines(db, botToken, now = new Date()) {
	const results = { posted: 0, skipped: 0, failed: 0, errors: [] as string[] };
	if (!db) return results;

	let configs;
	try {
		configs = await getEnabledTimelines(db);
	} catch (error) {
		log.error('[Anniversary] Failed to list enabled timelines:', error);
		return results;
	}

	if (configs.length === 0) return results;

	for (const config of configs) {
		const timeline = getTimeline(config.timeline_key);
		if (!timeline) continue;

		let clock;
		try {
			clock = zonedNow(now, config.timezone);
		} catch (error) {
			// Log the reason, not just the fact. A zone stored years ago can be
			// dropped from the ICU database, and "bad timezone" with no cause is
			// the kind of line you find on the one morning you cannot debug it.
			log.error(
				`[Anniversary] Bad timezone "${config.timezone}" for guild ${config.guild_id}:`,
				error
			);
			continue;
		}

		// The cheap exit, taken on every tick of every other day of the year.
		if (clock.month !== timeline.month || clock.day !== timeline.day) continue;

		const posted = await getPostedKeys(db, config.id, clock.year);
		const { due, expired } = dueEvents(timeline, clock, posted, config.grace_minutes);

		for (const event of expired) {
			if (await claimEvent(db, config.id, clock.year, event.key, 'skipped')) {
				results.skipped++;
				log.warn(
					`[Anniversary] Skipped ${timeline.key}/${event.key} for guild ${config.guild_id}: more than ${config.grace_minutes}m late`
				);
			}
		}

		if (!botToken) {
			if (due.length > 0) {
				log.error('[Anniversary] Bot token not configured; cannot post');
				results.errors.push('Bot token not configured');
			}
			continue;
		}

		for (const event of due) {
			// Claim first. If the post then fails the row stays 'failed' and is
			// not retried — see the header.
			if (!(await claimEvent(db, config.id, clock.year, event.key))) continue;

			try {
				const body = buildEventMessage(timeline, event, {
					year: clock.year,
					useEmbed: config.use_embed,
					color: config.embed_color,
				});
				const message = await postToChannel(botToken, config.channel_id, body);
				await markSent(db, config.id, clock.year, event.key, message?.id);
				results.posted++;
			} catch (error) {
				const message = error?.message || 'Unknown error';
				await markFailed(db, config.id, clock.year, event.key, message);
				results.failed++;
				results.errors.push(`${config.guild_id}/${event.key}: ${message}`);
				log.error(
					`[Anniversary] Failed to post ${event.key} for guild ${config.guild_id}:`,
					error
				);
			}

			// Same courtesy gap the scheduled-message sender uses.
			await new Promise((r) => setTimeout(r, 100));
		}
	}

	if (results.posted || results.failed || results.skipped) {
		log.info(
			`[Anniversary] posted ${results.posted}, skipped ${results.skipped}, failed ${results.failed}`
		);
	}

	return results;
}

/** What the dashboard shows: this year's log for one guild. */
export async function getAnniversaryPostLog(
	db,
	guildId,
	timelineKey = DEFAULT_TIMELINE_KEY,
	year?: number
) {
	if (!db) return [];

	const targetYear = year ?? new Date().getUTCFullYear();

	try {
		const result = await db
			.prepare(
				`SELECT p.event_key, p.status, p.message_id, p.error, p.claimed_at, p.sent_at
				 FROM anniversary_timeline_posts p
				 JOIN anniversary_timelines t ON t.id = p.timeline_id
				 WHERE t.guild_id = ? AND t.timeline_key = ? AND p.year = ?
				 ORDER BY p.id ASC`
			)
			.bind(guildId, timelineKey, targetYear)
			.all();

		return result.results || [];
	} catch (error) {
		log.error('[Anniversary] Failed to read post log:', error);
		return [];
	}
}
