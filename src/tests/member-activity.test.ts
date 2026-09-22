import { describe, expect, it, vi } from 'vitest';

/**
 * One member's own figures, and the rules that keep the endpoint from becoming
 * a way to read the server's logs about anybody:
 *
 *  - membership comes from the gateway's cache, not from old activity;
 *  - a non-member gets empty counts, not a history;
 *  - `members:read` is its own scope, not something `stats:read` implies;
 *  - a channel the server excludes from logging is never counted, and the
 *    answer says how many there are.
 */

vi.mock('$lib/db/logger.js', () => ({
	log: { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} },
}));

import {
	DEFAULT_WINDOW_DAYS,
	RETENTION_DAYS,
	getMemberActivity,
	normalizeWindowDays,
} from '$lib/db/member-activity.js';

/**
 * A database that answers by matching the statement, so each test states only
 * the rows it cares about. `binds` records what every statement was given,
 * which is how the SQL-injection guard below is checked without a real SQLite.
 */
type Answer = (binds: any[]) => any;

function fakeDb(answers: Array<[RegExp, Answer]>, seen: Array<{ sql: string; binds: any[] }> = []) {
	return {
		seen,
		prepare(sql: string) {
			let binds: any[] = [];
			const statement = {
				bind(...values: any[]) {
					binds = values;
					seen.push({ sql, binds: values });
					return statement;
				},
				async first() {
					for (const [pattern, answer] of answers) {
						if (pattern.test(sql)) return answer(binds);
					}
					return null;
				},
				async all() {
					return { results: [] };
				},
			};
			return statement;
		},
	};
}

const MEMBER: [RegExp, Answer] = [
	/guild_members_cache/,
	() => ({ joined_at: '2026-01-04 12:00:00', is_bot: 0 }),
];
const NO_SETTINGS: [RegExp, Answer] = [/guild_settings/, () => null];

describe('normalizeWindowDays', () => {
	it('defaults when the value is missing or unreadable', () => {
		expect(normalizeWindowDays(undefined)).toBe(DEFAULT_WINDOW_DAYS);
		expect(normalizeWindowDays('not a number')).toBe(DEFAULT_WINDOW_DAYS);
		// `searchParams.get` hands back null for a parameter nobody sent, and
		// `Number(null)` is 0 — which would clamp to a one-day window.
		expect(normalizeWindowDays(null)).toBe(DEFAULT_WINDOW_DAYS);
		expect(normalizeWindowDays('')).toBe(DEFAULT_WINDOW_DAYS);
	});

	it('clamps to the retention ceiling rather than refusing', () => {
		expect(normalizeWindowDays(3650)).toBe(RETENTION_DAYS);
		expect(normalizeWindowDays(0)).toBe(1);
		expect(normalizeWindowDays(-5)).toBe(1);
		expect(normalizeWindowDays('7')).toBe(7);
		expect(normalizeWindowDays(7.9)).toBe(7);
	});
});

describe('getMemberActivity', () => {
	it('reports a member who is not in the server, with no history', async () => {
		const db = fakeDb([[/guild_members_cache/, () => null]]);
		const result = await getMemberActivity(db, 'g1', '42');

		expect(result.member).toBe(false);
		expect(result.joinedAt).toBeNull();
		expect(result.activity.messages).toBe(0);
		expect(result.recorded.messages).toBe(0);
		expect(result.standing.messageRank).toBeNull();
	});

	it('answers empty without a database, a guild or a user', async () => {
		expect((await getMemberActivity(null, 'g1', '42')).member).toBe(false);
		expect((await getMemberActivity(fakeDb([]), '', '42')).member).toBe(false);
		expect((await getMemberActivity(fakeDb([]), 'g1', '')).member).toBe(false);
	});

	it('counts messages, voice and commands over the window', async () => {
		const db = fakeDb([
			MEMBER,
			NO_SETTINGS,
			[
				/FROM event_logs[\s\S]*actor_id = \?/,
				(binds) => ({
					// The window rides in as a bind, so a 30-day and a 90-day read are
					// distinguishable without a second statement.
					messages: binds[2] === '-30 days' ? 12 : 40,
					channels: 3,
					last_at: '2026-09-20 10:00:00',
				}),
			],
			[
				/FROM voice_sessions[\s\S]*user_id = \?/,
				() => ({ sessions: 4, channels: 2, seconds: 3600, last_at: '2026-09-19 22:00:00' }),
			],
			[/command_logs/, () => ({ commands: 7 })],
			[/SELECT actor_id, COUNT/, () => ({ population: 37, ahead: 3 })],
			[/SELECT user_id, COALESCE/, () => ({ population: 11, ahead: 1 })],
		]);

		const result = await getMemberActivity(db, 'g1', '42', 30);

		expect(result.member).toBe(true);
		expect(result.joinedAt).toBe('2026-01-04 12:00:00');
		expect(result.bot).toBe(false);
		expect(result.days).toBe(30);
		expect(result.retentionDays).toBe(RETENTION_DAYS);
		expect(result.activity).toMatchObject({
			messages: 12,
			channels: 3,
			lastMessageAt: '2026-09-20 10:00:00',
			voiceSeconds: 3600,
			voiceSessions: 4,
			voiceChannels: 2,
			commands: 7,
		});
		// The second window is the whole retained history, not a repeat of the first.
		expect(result.recorded.messages).toBe(40);
		expect(result.standing).toEqual({
			messageRank: 4,
			messagePopulation: 37,
			voiceRank: 2,
			voicePopulation: 11,
		});
	});

	it('gives no rank to somebody who did none of that thing', async () => {
		const db = fakeDb([
			MEMBER,
			NO_SETTINGS,
			[
				/FROM event_logs[\s\S]*actor_id = \?/,
				() => ({ messages: 0, channels: 0, last_at: null }),
			],
			[
				/FROM voice_sessions[\s\S]*user_id = \?/,
				() => ({ sessions: 0, channels: 0, seconds: 0, last_at: null }),
			],
			[/command_logs/, () => ({ commands: 0 })],
			[/SELECT actor_id, COUNT/, () => ({ population: 37, ahead: 37 })],
			[/SELECT user_id, COALESCE/, () => ({ population: 11, ahead: 11 })],
		]);

		const result = await getMemberActivity(db, 'g1', '42');

		expect(result.standing.messageRank).toBeNull();
		expect(result.standing.voiceRank).toBeNull();
		// The field size is still worth knowing — it is what "nobody posted this
		// month" and "you are the only one who didn't" are told apart by.
		expect(result.standing.messagePopulation).toBe(37);
	});

	it('excludes unlogged channels by binding their ids, never by interpolating them', async () => {
		const seen: Array<{ sql: string; binds: any[] }> = [];
		const db = fakeDb(
			[
				MEMBER,
				[
					/guild_settings/,
					() => ({ excluded_channels: JSON.stringify(["7'; DROP TABLE users;--", '8']) }),
				],
				[
					/FROM event_logs[\s\S]*actor_id = \?/,
					() => ({ messages: 2, channels: 1, last_at: null }),
				],
				[
					/FROM voice_sessions[\s\S]*user_id = \?/,
					() => ({ sessions: 0, channels: 0, seconds: 0, last_at: null }),
				],
				[/command_logs/, () => ({ commands: 0 })],
				[/SELECT actor_id, COUNT/, () => ({ population: 2, ahead: 0 })],
				[/SELECT user_id, COALESCE/, () => ({ population: 0, ahead: 0 })],
			],
			seen
		);

		const result = await getMemberActivity(db, 'g1', '42');

		expect(result.unrecordedChannels).toBe(2);
		const messageRead = seen.find((entry) =>
			/FROM event_logs[\s\S]*actor_id = \?/.test(entry.sql)
		);
		expect(messageRead?.sql).toContain('channel_id NOT IN (?, ?)');
		expect(messageRead?.sql).not.toContain('DROP TABLE');
		expect(messageRead?.binds).toContain("7'; DROP TABLE users;--");
	});

	it('leaves the totals alone when the exclusion list is malformed', async () => {
		const db = fakeDb([
			MEMBER,
			[/guild_settings/, () => ({ excluded_channels: '{not json' })],
			[
				/FROM event_logs[\s\S]*actor_id = \?/,
				() => ({ messages: 5, channels: 1, last_at: null }),
			],
			[
				/FROM voice_sessions[\s\S]*user_id = \?/,
				() => ({ sessions: 0, channels: 0, seconds: 0, last_at: null }),
			],
			[/command_logs/, () => ({ commands: 0 })],
			[/SELECT actor_id, COUNT/, () => ({ population: 1, ahead: 0 })],
			[/SELECT user_id, COALESCE/, () => ({ population: 0, ahead: 0 })],
		]);

		const result = await getMemberActivity(db, 'g1', '42');
		expect(result.unrecordedChannels).toBe(0);
		expect(result.activity.messages).toBe(5);
	});

	it('survives a read that throws, one count at a time', async () => {
		const db = {
			prepare(sql: string) {
				const statement = {
					bind: () => statement,
					async first() {
						if (/guild_members_cache/.test(sql)) return { joined_at: null, is_bot: 1 };
						throw new Error('D1 is having a day');
					},
					async all() {
						throw new Error('D1 is having a day');
					},
				};
				return statement;
			},
		};

		const result = await getMemberActivity(db, 'g1', '42');
		expect(result.member).toBe(true);
		expect(result.bot).toBe(true);
		expect(result.joinedAt).toBeNull();
		expect(result.activity).toMatchObject({ messages: 0, voiceSeconds: 0, commands: 0 });
		expect(result.standing.messagePopulation).toBe(0);
	});
});
