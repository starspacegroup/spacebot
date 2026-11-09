/**
 * A visit that falls between two hourly runs is seen twice: once by the minute-by-minute
 * check and once by the hourly replay of join/leave events. It must be stored once.
 * Runs against real SQLite because the fix lives in the SQL.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { processVoiceSessions, reconcileVoiceSessions } from '$lib/db/stats-aggregation.js';

const SCHEMA =
	fs.readFileSync(path.resolve('migrations/0010_aggregated_stats.sql'), 'utf8') +
	`CREATE TABLE event_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, event_type TEXT,
		actor_id TEXT, target_id TEXT, channel_id TEXT, channel_name TEXT, created_at DATETIME
	);`;

const G = 'g1';
function setup() {
	const db = createSqliteD1(SCHEMA);
	const ev = (type: string, user: string, channel: string, at: string) =>
		db
			.prepare(
				'INSERT INTO event_logs (guild_id, event_type, actor_id, channel_id, channel_name, created_at) VALUES (?,?,?,?,?,?)'
			)
			.bind(G, type, user, channel, '#' + channel, at)
			.run();
	const rows = () =>
		db
			.prepare('SELECT * FROM voice_sessions ORDER BY id')
			.all()
			.then((r: any) => r.results);
	return { db, ev, rows };
}
const snap = (user: string, channel: string) => [{ user_id: user, channel_id: channel }];

describe('a visit between two hourly runs is stored once', () => {
	it('joined, seen by the minute check, left, then the events are replayed', async () => {
		const { db, ev, rows } = setup();
		await ev('VOICE_JOIN', 'u1', 'c1', '2026-11-01 10:00:30');
		await ev('VOICE_LEAVE', 'u1', 'c1', '2026-11-01 10:30:10');
		await reconcileVoiceSessions(db, G, snap('u1', 'c1'), '2026-11-01 10:01:00');
		await reconcileVoiceSessions(db, G, [], '2026-11-01 10:31:00');
		await processVoiceSessions(db, G);
		const r = await rows();
		expect(r).toHaveLength(1);
		expect(r[0].joined_at).toBe('2026-11-01 10:00:30');
		expect(r[0].left_at).toBe('2026-11-01 10:30:10');
		expect(r[0].duration_seconds).toBe(1780);
	});

	it('still in the channel when the replay runs', async () => {
		const { db, ev, rows } = setup();
		await ev('VOICE_JOIN', 'u1', 'c1', '2026-11-01 10:00:30');
		await reconcileVoiceSessions(db, G, snap('u1', 'c1'), '2026-11-01 10:01:00');
		await processVoiceSessions(db, G);
		const r = await rows();
		expect(r).toHaveLength(1);
		expect(r[0].joined_at).toBe('2026-11-01 10:00:30');
		expect(r[0].left_at).toBeNull();
	});

	it('moved channels between runs: one row per channel, no overlap', async () => {
		const { db, ev, rows } = setup();
		await ev('VOICE_JOIN', 'u1', 'c1', '2026-11-01 10:00:00');
		await ev('VOICE_MOVE', 'u1', 'c2', '2026-11-01 10:20:00');
		await ev('VOICE_LEAVE', 'u1', 'c2', '2026-11-01 10:40:00');
		await reconcileVoiceSessions(db, G, snap('u1', 'c1'), '2026-11-01 10:01:00');
		await reconcileVoiceSessions(db, G, snap('u1', 'c2'), '2026-11-01 10:21:00');
		await reconcileVoiceSessions(db, G, [], '2026-11-01 10:41:00');
		await processVoiceSessions(db, G);
		const r = await rows();
		expect(r.map((x: any) => [x.channel_id, x.joined_at, x.left_at])).toEqual([
			['c1', '2026-11-01 10:00:00', '2026-11-01 10:20:00'],
			['c2', '2026-11-01 10:20:00', '2026-11-01 10:40:00'],
		]);
		const total = r.reduce((n: number, x: any) => n + x.duration_seconds, 0);
		expect(total).toBe(40 * 60);
	});

	it('a normal replay with no minute check is unchanged', async () => {
		const { db, ev, rows } = setup();
		await ev('VOICE_JOIN', 'u1', 'c1', '2026-11-01 10:00:00');
		await ev('VOICE_LEAVE', 'u1', 'c1', '2026-11-01 10:10:00');
		await processVoiceSessions(db, G);
		const r = await rows();
		expect(r).toHaveLength(1);
		expect(r[0].duration_seconds).toBe(600);
	});

	it('two separate visits by one person stay two', async () => {
		const { db, ev, rows } = setup();
		await ev('VOICE_JOIN', 'u1', 'c1', '2026-11-01 10:00:00');
		await ev('VOICE_LEAVE', 'u1', 'c1', '2026-11-01 10:10:00');
		await ev('VOICE_JOIN', 'u1', 'c1', '2026-11-01 11:00:00');
		await ev('VOICE_LEAVE', 'u1', 'c1', '2026-11-01 11:10:00');
		await reconcileVoiceSessions(db, G, snap('u1', 'c1'), '2026-11-01 10:01:00');
		await reconcileVoiceSessions(db, G, [], '2026-11-01 10:11:00');
		await reconcileVoiceSessions(db, G, snap('u1', 'c1'), '2026-11-01 11:01:00');
		await reconcileVoiceSessions(db, G, [], '2026-11-01 11:11:00');
		await processVoiceSessions(db, G);
		const r = await rows();
		expect(r).toHaveLength(2);
		expect(r.map((x: any) => x.duration_seconds)).toEqual([600, 600]);
	});
});
