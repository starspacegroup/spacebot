import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the channel directory says about how a channel is *used*.
 *
 * The rules worth pinning down are the ones a public page depends on:
 * aggregate counts only, an excluded channel reported as unknown rather than
 * silent, and a window that never claims more history than the firehose keeps.
 */

vi.mock('$lib/db/logger.js', () => ({
	log: { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} },
}));

const { getChannelActivity, normalizeActivityDays, MAX_ACTIVITY_DAYS, DEFAULT_ACTIVITY_DAYS } =
	await import('../lib/db/channel-activity.js');

/** Rows the fake database hands back, keyed by a fragment of the query. */
type Rows = {
	settings?: any;
	presets?: any[];
	messages?: any[];
	voice?: any[];
	hours?: any[];
};

let rows: Rows = {};
/** Every SQL string the module ran, so a test can assert what it did not do. */
let asked: string[] = [];

const db = {
	prepare(sql: string) {
		asked.push(sql);
		const pick = () => {
			if (sql.includes('guild_settings')) return { first: rows.settings ?? null, all: [] };
			if (sql.includes('channel_presets')) return { first: null, all: rows.presets ?? [] };
			if (sql.includes('MESSAGE_CREATE')) return { first: null, all: rows.messages ?? [] };
			if (sql.includes("strftime('%H'")) return { first: null, all: rows.hours ?? [] };
			if (sql.includes('voice_sessions')) return { first: null, all: rows.voice ?? [] };
			return { first: null, all: [] };
		};
		return {
			bind: () => ({
				first: async () => pick().first,
				all: async () => ({ results: pick().all }),
			}),
		};
	},
};

beforeEach(() => {
	rows = {};
	asked = [];
});

describe('normalizeActivityDays', () => {
	it('defaults when nothing usable is given', () => {
		expect(normalizeActivityDays(undefined)).toBe(DEFAULT_ACTIVITY_DAYS);
		expect(normalizeActivityDays('soon')).toBe(DEFAULT_ACTIVITY_DAYS);
	});

	it('clamps to the window the raw events actually cover', () => {
		expect(normalizeActivityDays(365)).toBe(MAX_ACTIVITY_DAYS);
		expect(normalizeActivityDays(0)).toBe(1);
		expect(normalizeActivityDays('14')).toBe(14);
	});
});

describe('getChannelActivity', () => {
	it('reports messages, posters and recency per channel', async () => {
		rows.messages = [
			{ channel_id: '100', messages: 91, posters: 7, last_at: '2026-09-08 18:04:00' },
		];

		const report = await getChannelActivity(db, 'g1', ['100', '200'], 30);

		expect(report.days).toBe(30);
		expect(report.channels['100']).toMatchObject({
			messages: 91,
			posters: 7,
			lastMessageAt: '2026-09-08 18:04:00',
		});
		// A channel with nothing to report is still listed, at zero.
		expect(report.channels['200']).toMatchObject({ messages: 0, posters: 0 });
	});

	it('reports voice time, head count and the hour it fills up', async () => {
		rows.voice = [
			{
				channel_id: '300',
				sessions: 12,
				people: 3,
				seconds: 17936,
				typical: 1494.6,
				last_at: '2026-09-08 20:11:00',
			},
		];
		rows.hours = [
			{ channel_id: '300', hour: 14, joins: 2 },
			{ channel_id: '300', hour: 20, joins: 9 },
		];

		const report = await getChannelActivity(db, 'g1', ['300'], 30);

		expect(report.channels['300']).toMatchObject({
			voiceSessions: 12,
			voicePeople: 3,
			voiceSeconds: 17936,
			typicalStaySeconds: 1495,
			busiestHourUtc: 20,
			lastVoiceAt: '2026-09-08 20:11:00',
		});
	});

	it('marks the lobby that hands a member their own room', async () => {
		rows.presets = [{ lobby_channel_id: '400' }];

		const report = await getChannelActivity(db, 'g1', ['300', '400'], 30);

		expect(report.channels['400'].lobby).toBe(true);
		expect(report.channels['300'].lobby).toBe(false);
	});

	it('reports an unlogged channel as unknown, never as quiet', async () => {
		rows.settings = { excluded_channels: '["100"]', timezone: 'America/New_York' };
		// An event from before the exclusion must not resurrect a number.
		rows.messages = [{ channel_id: '100', messages: 40, posters: 4, last_at: '2026-08-01' }];

		const report = await getChannelActivity(db, 'g1', ['100'], 30);

		expect(report.channels['100'].messages).toBeNull();
		expect(report.channels['100'].posters).toBeNull();
		expect(report.timezone).toBe('America/New_York');
	});

	it('never asks about a channel the caller did not list', async () => {
		rows.messages = [{ channel_id: '999', messages: 5, posters: 1, last_at: '2026-09-01' }];

		const report = await getChannelActivity(db, 'g1', ['100'], 30);

		expect(report.channels['999']).toBeUndefined();
	});

	it('does nothing at all without a database or a channel list', async () => {
		expect((await getChannelActivity(null, 'g1', ['100'])).channels).toEqual({});
		expect((await getChannelActivity(db, 'g1', [])).channels).toEqual({});
		expect(asked).toEqual([]);
	});

	it('survives a database that throws, reporting what it could read', async () => {
		const angry = {
			prepare(sql: string) {
				return {
					bind: () => ({
						first: async () => {
							throw new Error('no');
						},
						all: async () => {
							if (sql.includes('MESSAGE_CREATE')) throw new Error('no');
							return { results: [] };
						},
					}),
				};
			},
		};

		const report = await getChannelActivity(angry, 'g1', ['100'], 7);

		expect(report.days).toBe(7);
		expect(report.channels['100']).toMatchObject({ messages: 0, voiceSeconds: 0 });
	});
});
