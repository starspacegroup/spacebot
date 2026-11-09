/**
 * Stats accuracy fixes from the 2026-11-08 audit. The behaviour lives in the SQL,
 * so these run on real SQLite.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	distinctPeopleForDay,
	getMemberGrowthChart,
	getMessageActivityChart,
	getVoiceActivityChart,
} from '$lib/db/stats-aggregation.js';
import { getTopVoiceUsers } from '$lib/db/statistics.js';

const SCHEMA =
	fs.readFileSync(path.resolve('migrations/0010_aggregated_stats.sql'), 'utf8') +
	fs.readFileSync(path.resolve('migrations/0099_stats_accuracy.sql'), 'utf8') +
	`CREATE TABLE event_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, event_type TEXT,
		actor_id TEXT, actor_name TEXT, actor_avatar TEXT, actor_discriminator TEXT,
		actor_is_bot INTEGER DEFAULT 0,
		target_id TEXT, target_name TEXT, target_avatar TEXT,
		channel_id TEXT, channel_name TEXT, created_at DATETIME
	);`;

const G = 'g1';
const sql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const ago = (min: number) => sql(Date.now() - min * 60_000);

function setup() {
	const db = createSqliteD1(SCHEMA);
	const event = (type: string, user: string, bot = 0, at = ago(1), name = user) =>
		db
			.prepare(
				'INSERT INTO event_logs (guild_id, event_type, actor_id, actor_name, actor_is_bot, created_at) VALUES (?,?,?,?,?,?)'
			)
			.bind(G, type, user, name, bot, at)
			.run();
	const session = (
		user: string,
		joinedMinAgo: number,
		leftMinAgo: number | null,
		bot: number | null = 0
	) =>
		db
			.prepare(
				'INSERT INTO voice_sessions (guild_id, user_id, channel_id, joined_at, left_at, is_bot) VALUES (?,?,?,?,?,?)'
			)
			.bind(
				G,
				user,
				'c1',
				ago(joinedMinAgo),
				leftMinAgo === null ? null : ago(leftMinAgo),
				bot
			)
			.run();
	return { db, event, session };
}

describe('member growth', () => {
	it('counts today once, not twice, and splits out bots', async () => {
		const { db, event } = setup();
		await event('MEMBER_JOIN', 'h1');
		await event('MEMBER_JOIN', 'b1', 1);
		await event('MEMBER_LEAVE', 'h2');
		const rows = await getMemberGrowthChart(db, G, '7d', null);
		const today = rows[rows.length - 1];
		expect(today.joins).toBe(2);
		expect(today.leaves).toBe(1);
		expect(today.joinsHuman).toBe(1);
		expect(today.leavesHuman).toBe(1);
	});
});

describe('the hour in progress', () => {
	it('voice chart includes a visit in progress (the peak query used to throw)', async () => {
		const { db, session } = setup();
		await session('u1', 130, null);
		const rows = await getVoiceActivityChart(db, G, '7d', null);
		const today = rows[rows.length - 1];
		expect(today.totalMinutes).toBeGreaterThan(0);
		expect(today.peakConcurrent).toBeGreaterThanOrEqual(1);
	});
});

describe('message chart', () => {
	it('counts people only, reports bots separately, and counts real unique posters', async () => {
		const { db, event } = setup();
		await event('MESSAGE_CREATE', 'h1');
		await event('MESSAGE_CREATE', 'h1');
		await event('MESSAGE_CREATE', 'h2');
		await event('MESSAGE_CREATE', 'b1', 1);
		await event('MESSAGE_CREATE', 'b2', 1);
		const rows = await getMessageActivityChart(db, G, '7d', null);
		const today = rows[rows.length - 1];
		expect(today.messageCount).toBe(3);
		expect(today.botMessageCount).toBe(2);
		expect(today.messageUniqueUsers).toBe(2);
	});

	it('unique posters over a day is the number of people, not the busiest hour', async () => {
		const { db, event } = setup();
		// Three different people post in three different hours of one day.
		await event('MESSAGE_CREATE', 'a', 0, '2026-10-01 01:10:00');
		await event('MESSAGE_CREATE', 'b', 0, '2026-10-01 05:10:00');
		await event('MESSAGE_CREATE', 'c', 0, '2026-10-01 09:10:00');
		await event('MESSAGE_CREATE', 'c', 1, '2026-10-01 10:10:00');
		const d = await distinctPeopleForDay(db, G, '2026-10-01 00:00:00', '2026-10-02 00:00:00');
		expect(d).toEqual({ voice: 0, messages: 3, humanMessages: 3 });
	});
});

describe('top voice users', () => {
	it('adds up sessions, cuts time before the window, and flags bots', async () => {
		const { db, event, session } = setup();
		await event('VOICE_JOIN', 'u1', 0, ago(500), 'Una');
		await event('VOICE_JOIN', 'bot', 1, ago(500), 'Tunes');
		await session('u1', 100, 70); // 30 min
		await session('u1', 50, 40); // 10 min
		await session('bot', 200, 100, 1); // 100 min
		const rows = await getTopVoiceUsers(db, G, 10, '7d');
		const una = rows.find((r: any) => r.actor_id === 'u1');
		const bot = rows.find((r: any) => r.actor_id === 'bot');
		expect(Math.round(una.total_seconds / 60)).toBe(40);
		expect(una.actor_name).toBe('Una');
		expect(una.actor_is_bot).toBe(0);
		expect(bot.actor_is_bot).toBe(1);
	});

	it('a visit that began before the window only counts the part inside it', async () => {
		const { db, session } = setup();
		const dayMin = 24 * 60;
		await session('u1', dayMin + 60, dayMin - 60); // 2 h, half before a 1-day window
		const rows = await getTopVoiceUsers(db, G, 10, '1d');
		expect(Math.round(rows[0].total_seconds / 60)).toBe(60);
	});
});
