import { describe, it, expect, vi } from 'vitest';
import {
	ANNIVERSARY_TIMELINES,
	dueEvents,
	getTimeline,
	minutesOfDay,
	yearsSince,
	zonedNow,
} from '../lib/anniversaries.js';
import {
	buildEventMessage,
	formatClock,
	normalizeAnniversarySettings,
	processAnniversaryTimelines,
} from '../lib/db/anniversary-timeline.js';

const SEPT11 = getTimeline('september-11-2001')!;

describe('timeline data', () => {
	it('has unique, stable event keys', () => {
		for (const timeline of ANNIVERSARY_TIMELINES) {
			const keys = timeline.events.map((e) => e.key);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});

	it('is ordered by time', () => {
		for (const timeline of ANNIVERSARY_TIMELINES) {
			const times = timeline.events.map((e) => minutesOfDay(e.time));
			expect(times.every((t) => t !== null)).toBe(true);
			expect([...times].sort((a, b) => a! - b!)).toEqual(times);
		}
	});

	it('has exactly one opening and one closing event', () => {
		for (const timeline of ANNIVERSARY_TIMELINES) {
			expect(timeline.events.filter((e) => e.opening)).toHaveLength(1);
			expect(timeline.events.filter((e) => e.closing)).toHaveLength(1);
		}
	});

	it('puts the impacts and collapses at the minutes they happened', () => {
		const at = (key: string) => SEPT11.events.find((e) => e.key === key)?.time;
		expect(at('north-tower-struck')).toBe('08:46');
		expect(at('south-tower-struck')).toBe('09:03');
		expect(at('pentagon-struck')).toBe('09:37');
		expect(at('south-tower-falls')).toBe('09:59');
		expect(at('ua93-crashes')).toBe('10:03');
		expect(at('north-tower-falls')).toBe('10:28');
	});
});

describe('minutesOfDay', () => {
	it('parses a wall clock', () => {
		expect(minutesOfDay('00:00')).toBe(0);
		expect(minutesOfDay('08:46')).toBe(526);
		expect(minutesOfDay('23:59')).toBe(1439);
	});

	it('rejects nonsense rather than guessing', () => {
		expect(minutesOfDay('8:46')).toBeNull();
		expect(minutesOfDay('24:00')).toBeNull();
		expect(minutesOfDay('08:60')).toBeNull();
		expect(minutesOfDay('')).toBeNull();
	});
});

describe('zonedNow', () => {
	// 2026-09-11T12:46:00Z is 08:46 in New York (EDT, UTC-4).
	const instant = new Date('2026-09-11T12:46:00Z');

	it('reads the wall clock in the requested zone', () => {
		expect(zonedNow(instant, 'America/New_York')).toEqual({
			year: 2026,
			month: 9,
			day: 11,
			minutes: 8 * 60 + 46,
		});
	});

	it('applies daylight saving rather than a fixed offset', () => {
		// The bug this guards: September is EDT (UTC-4), not EST (UTC-5). A
		// hardcoded -5 would put the whole day an hour early, every year.
		const winter = new Date('2026-01-11T12:46:00Z');
		expect(zonedNow(winter, 'America/New_York').minutes).toBe(7 * 60 + 46);
	});

	it('rolls the date over for zones on the other side of it', () => {
		const sydney = zonedNow(instant, 'Australia/Sydney');
		expect(sydney.day).toBe(11);
		expect(sydney.minutes).toBe(22 * 60 + 46);

		// Late on the 11th in New York is already the 12th in Sydney.
		const evening = zonedNow(new Date('2026-09-12T01:00:00Z'), 'Australia/Sydney');
		expect(evening.day).toBe(12);
	});
});

describe('dueEvents', () => {
	const clockAt = (minutes: number) => ({ month: 9, day: 11, minutes });

	it('returns nothing on any other day', () => {
		const { due } = dueEvents(SEPT11, { month: 9, day: 12, minutes: 526 }, new Set(), 15);
		expect(due).toEqual([]);
	});

	it('returns an event at its own minute', () => {
		const { due } = dueEvents(SEPT11, clockAt(526), new Set(), 15);
		expect(due.map((e) => e.key)).toContain('north-tower-struck');
	});

	it('does not return an event early', () => {
		const { due } = dueEvents(SEPT11, clockAt(525), new Set(), 15);
		expect(due.map((e) => e.key)).not.toContain('north-tower-struck');
	});

	it('still posts inside the grace window', () => {
		const { due, expired } = dueEvents(SEPT11, clockAt(526 + 10), new Set(), 15);
		expect(due.map((e) => e.key)).toContain('north-tower-struck');
		expect(expired.map((e) => e.key)).not.toContain('north-tower-struck');
	});

	it('expires an event past the grace window instead of posting it late', () => {
		const { due, expired } = dueEvents(SEPT11, clockAt(526 + 16), new Set(), 15);
		expect(due.map((e) => e.key)).not.toContain('north-tower-struck');
		expect(expired.map((e) => e.key)).toContain('north-tower-struck');
	});

	it('never returns something already posted', () => {
		const posted = new Set(['north-tower-struck']);
		const { due, expired } = dueEvents(SEPT11, clockAt(600), posted, 15);
		expect(due.map((e) => e.key)).not.toContain('north-tower-struck');
		expect(expired.map((e) => e.key)).not.toContain('north-tower-struck');
	});

	it('does not dump the whole morning when a tick is missed for hours', () => {
		// 21:00 on the day, nothing posted all day: only the closing event is
		// still inside its window. This is the burst the grace window exists to
		// prevent.
		const { due } = dueEvents(SEPT11, clockAt(21 * 60), new Set(), 15);
		expect(due.map((e) => e.key)).toEqual(['toll']);
	});
});

describe('formatClock', () => {
	it('renders the clock people remember', () => {
		expect(formatClock('08:46')).toBe('8:46 AM');
		expect(formatClock('09:59')).toBe('9:59 AM');
		expect(formatClock('12:16')).toBe('12:16 PM');
		expect(formatClock('13:04')).toBe('1:04 PM');
		expect(formatClock('20:30')).toBe('8:30 PM');
	});
});

describe('yearsSince', () => {
	it('counts from the year it happened', () => {
		expect(yearsSince(SEPT11, 2026)).toBe(25);
	});

	it('is null in the source year, so the opening post does not say "0 years ago"', () => {
		expect(yearsSince(SEPT11, 2001)).toBeNull();
	});
});

describe('buildEventMessage', () => {
	const opening = SEPT11.events.find((e) => e.opening)!;
	const impact = SEPT11.events.find((e) => e.key === 'north-tower-struck')!;

	it('puts the anniversary framing on the opening post only', () => {
		const first = buildEventMessage(SEPT11, opening, { year: 2026, useEmbed: true });
		expect(JSON.stringify(first)).toContain('25 years ago today');

		const later = buildEventMessage(SEPT11, impact, { year: 2026, useEmbed: true });
		expect(JSON.stringify(later)).not.toContain('years ago today');
	});

	it('leads an embed with the time', () => {
		const message = buildEventMessage(SEPT11, impact, { year: 2026, useEmbed: true });
		expect(message.embeds?.[0].title).toBe('8:46 AM — The North Tower is struck');
	});

	it('falls back to plain text when embeds are off', () => {
		const message = buildEventMessage(SEPT11, impact, { year: 2026, useEmbed: false });
		expect(message.content).toContain('8:46 AM');
		expect(message.embeds).toBeUndefined();
	});

	it('honours a guild embed colour over the timeline default', () => {
		const message = buildEventMessage(SEPT11, impact, {
			year: 2026,
			useEmbed: true,
			color: 0x112233,
		});
		expect(message.embeds?.[0].color).toBe(0x112233);
	});
});

describe('normalizeAnniversarySettings', () => {
	it('refuses to enable without a channel', () => {
		const result = normalizeAnniversarySettings({ enabled: true, channel_id: '' });
		expect(result.ok).toBe(false);
	});

	it('allows staying off without a channel', () => {
		const result = normalizeAnniversarySettings({ enabled: false, channel_id: '' });
		expect(result.ok).toBe(true);
	});

	it('rejects a channel id that is not one', () => {
		const result = normalizeAnniversarySettings({ enabled: true, channel_id: 'general' });
		expect(result.ok).toBe(false);
	});

	it('rejects an unknown timezone rather than silently defaulting', () => {
		const result = normalizeAnniversarySettings({
			enabled: true,
			channel_id: '123456789012345678',
			timezone: 'Mars/Olympus',
		});
		expect(result.ok).toBe(false);
	});

	it('clamps the grace window', () => {
		const low = normalizeAnniversarySettings({
			channel_id: '123456789012345678',
			grace_minutes: 0,
		});
		const high = normalizeAnniversarySettings({
			channel_id: '123456789012345678',
			grace_minutes: 9999,
		});
		expect(low.value.grace_minutes).toBe(1);
		expect(high.value.grace_minutes).toBe(240);
	});

	it('accepts a hex colour with or without the hash', () => {
		expect(
			normalizeAnniversarySettings({
				channel_id: '123456789012345678',
				embed_color: '#2B2D31',
			}).value.embed_color
		).toBe(0x2b2d31);
		expect(
			normalizeAnniversarySettings({
				channel_id: '123456789012345678',
				embed_color: '2B2D31',
			}).value.embed_color
		).toBe(0x2b2d31);
	});
});

/**
 * A D1-shaped fake. Only the four statements the dispatcher issues are
 * recognised; anything else throws, so a query added later cannot pass the
 * tests by being silently ignored.
 */
function fakeDb(config, posted = new Map<string, string>()) {
	const claims: string[] = [];

	return {
		claims,
		posted,
		prepare(sql: string) {
			const binds: any[] = [];
			const api = {
				bind(...args: any[]) {
					binds.push(...args);
					return api;
				},
				async all() {
					if (sql.includes('FROM anniversary_timelines')) {
						return { results: config ? [config] : [] };
					}
					if (sql.includes('SELECT event_key FROM anniversary_timeline_posts')) {
						return { results: [...posted.keys()].map((event_key) => ({ event_key })) };
					}
					throw new Error(`unexpected all(): ${sql}`);
				},
				async first() {
					throw new Error(`unexpected first(): ${sql}`);
				},
				async run() {
					if (sql.includes('INSERT OR IGNORE INTO anniversary_timeline_posts')) {
						const eventKey = binds[2];
						if (posted.has(eventKey)) return { meta: { changes: 0 } };
						posted.set(eventKey, binds[3]);
						claims.push(eventKey);
						return { meta: { changes: 1 } };
					}
					if (sql.includes('UPDATE anniversary_timeline_posts')) {
						return { meta: { changes: 1 } };
					}
					throw new Error(`unexpected run(): ${sql}`);
				},
			};
			return api;
		},
	};
}

const enabledConfig = {
	id: 7,
	guild_id: '111111111111111111',
	timeline_key: 'september-11-2001',
	enabled: 1,
	channel_id: '222222222222222222',
	timezone: 'America/New_York',
	grace_minutes: 15,
	use_embed: 1,
	embed_color: null,
};

describe('processAnniversaryTimelines', () => {
	// Typed with the two arguments fetch is actually called with, so
	// `mock.calls[0]` is a pair rather than an empty tuple.
	function mockFetchOk() {
		return vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			status: 200,
			json: async () => ({ id: '999' }),
			text: async () => '',
		}));
	}

	it('does nothing on any other day, and does not even look at the clock twice', async () => {
		const db = fakeDb(enabledConfig);
		const fetchSpy = mockFetchOk();
		vi.stubGlobal('fetch', fetchSpy);

		const result = await processAnniversaryTimelines(
			db,
			'token',
			new Date('2026-09-10T12:46:00Z')
		);

		expect(result.posted).toBe(0);
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('posts the event whose minute it is', async () => {
		const db = fakeDb(enabledConfig);
		const fetchSpy = mockFetchOk();
		vi.stubGlobal('fetch', fetchSpy);

		const result = await processAnniversaryTimelines(
			db,
			'token',
			new Date('2026-09-11T11:59:00Z') // 07:59 EDT — the opening event
		);

		expect(result.posted).toBe(1);
		expect(db.claims).toEqual(['aa11-departs']);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://discord.com/api/v10/channels/222222222222222222/messages');
		expect(JSON.parse(String(init?.body)).embeds[0].description).toContain('92 people aboard');
		vi.unstubAllGlobals();
	});

	it('never posts the same event twice, however many times it ticks', async () => {
		const posted = new Map<string, string>();
		const fetchSpy = mockFetchOk();
		vi.stubGlobal('fetch', fetchSpy);

		const at = new Date('2026-09-11T11:59:00Z');
		await processAnniversaryTimelines(fakeDb(enabledConfig, posted), 'token', at);
		await processAnniversaryTimelines(fakeDb(enabledConfig, posted), 'token', at);
		await processAnniversaryTimelines(fakeDb(enabledConfig, posted), 'token', at);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it('marks a missed event skipped instead of posting it hours late', async () => {
		const posted = new Map<string, string>();
		const db = fakeDb(enabledConfig, posted);
		const fetchSpy = mockFetchOk();
		vi.stubGlobal('fetch', fetchSpy);

		// 13:00 EDT with nothing posted: the morning is long past its window.
		const result = await processAnniversaryTimelines(
			db,
			'token',
			new Date('2026-09-11T17:00:00Z')
		);

		expect(result.skipped).toBeGreaterThan(0);
		expect(posted.get('north-tower-struck')).toBe('skipped');
		// 13:04 EDT has not arrived, so nothing is posted at all here.
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('records a failed send and does not retry it on the next tick', async () => {
		const posted = new Map<string, string>();
		const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: false,
			status: 403,
			text: async () => 'Missing Permissions',
			json: async () => ({}),
		}));
		vi.stubGlobal('fetch', fetchSpy);

		const at = new Date('2026-09-11T11:59:00Z');
		const first = await processAnniversaryTimelines(fakeDb(enabledConfig, posted), 'token', at);
		expect(first.failed).toBe(1);

		const second = await processAnniversaryTimelines(
			fakeDb(enabledConfig, posted),
			'token',
			at
		);
		expect(second.failed).toBe(0);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it("reads the day on the guild's chosen clock, not the server's", async () => {
		// 2026-09-11T23:30Z is still the 11th in New York but already the 12th
		// in Sydney. A guild reading against Sydney must post nothing.
		const sydney = { ...enabledConfig, timezone: 'Australia/Sydney' };
		const fetchSpy = mockFetchOk();
		vi.stubGlobal('fetch', fetchSpy);

		const result = await processAnniversaryTimelines(
			fakeDb(sydney),
			'token',
			new Date('2026-09-11T23:30:00Z')
		);

		expect(result.posted).toBe(0);
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('ignores a guild that has it switched off', async () => {
		// getEnabledTimelines filters in SQL; this asserts the fake's contract
		// matches, so the other tests are not passing for the wrong reason.
		const db = fakeDb(null);
		const fetchSpy = mockFetchOk();
		vi.stubGlobal('fetch', fetchSpy);

		const result = await processAnniversaryTimelines(
			db,
			'token',
			new Date('2026-09-11T11:59:00Z')
		);

		expect(result.posted).toBe(0);
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
