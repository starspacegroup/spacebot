/**
 * Hourly aggregates are pruned after 30 days; the daily rollups are kept. The
 * 60d/90d charts and totals must fall back to the daily rows for the older
 * part, without counting a day from both sources. These run on real SQLite.
 */
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	getMemberGrowthSummary,
	getMessageActivityChart,
	getVoiceActivityChart,
	getVoiceActivitySummary,
} from '../lib/db/stats-aggregation.js';

const G = '111111111111111111';

const SCHEMA = `
	CREATE TABLE aggregated_stats (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id TEXT NOT NULL,
		period_type TEXT NOT NULL,
		period_start DATETIME NOT NULL,
		period_end DATETIME NOT NULL,
		member_joins INTEGER DEFAULT 0,
		member_leaves INTEGER DEFAULT 0,
		member_net_change INTEGER DEFAULT 0,
		voice_total_seconds INTEGER DEFAULT 0,
		voice_unique_users INTEGER DEFAULT 0,
		voice_peak_concurrent INTEGER DEFAULT 0,
		message_count INTEGER DEFAULT 0,
		message_unique_users INTEGER DEFAULT 0
	);
	CREATE TABLE voice_sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id TEXT,
		user_id TEXT,
		joined_at DATETIME,
		left_at DATETIME,
		duration_seconds INTEGER
	);
`;

/** A UTC day `daysAgo` days back, as 'YYYY-MM-DD'. */
function day(daysAgo: number) {
	return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

function seed(db: any) {
	const add = (type: string, start: string, voice: number, msgs: number, joins: number) =>
		db
			.prepare(
				`INSERT INTO aggregated_stats
				 (guild_id, period_type, period_start, period_end, voice_total_seconds, voice_unique_users,
				  voice_peak_concurrent, message_count, message_unique_users, member_joins, member_net_change)
				 VALUES (?, ?, ?, ?, ?, 3, 2, ?, 4, ?, ?)`
			)
			.bind(G, type, start, start, voice, msgs, joins, joins)
			.run();
	// Daily rollups: old days and a recent day that ALSO has hourly rows.
	add('daily', `${day(60)} 00:00:00`, 7200, 10, 2);
	add('daily', `${day(40)} 00:00:00`, 3600, 5, 1);
	add('daily', `${day(3)} 00:00:00`, 99999, 99, 9);
	// Hourly rows for the recent day: two hours, 1800s each.
	add('hourly', `${day(3)} 10:00:00`, 1800, 2, 1);
	add('hourly', `${day(3)} 11:00:00`, 1800, 3, 1);
}

describe('rollup window for long periods', () => {
	it('voice chart shows days older than the hourly retention (90d)', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db);
		const chart = await getVoiceActivityChart(db, G, '90d', null);
		const by = new Map(chart.map((r: any) => [r.date, r]));
		expect(by.get(day(60))?.totalHours).toBe(2);
		expect(by.get(day(40))?.totalHours).toBe(1);
	});

	it('does not count a recent day from both hourly and daily rows', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db);
		const chart = await getVoiceActivityChart(db, G, '90d', null);
		const recent: any = chart.find((r: any) => r.date === day(3));
		expect(recent.totalMinutes).toBe(60); // two hourly rows, not the 99999s daily
	});

	it('a 30d view is unchanged by the daily fallback', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db);
		const chart = await getVoiceActivityChart(db, G, '30d', null);
		expect(chart.find((r: any) => r.date === day(40))).toBeUndefined();
		expect(chart.find((r: any) => r.date === day(3))?.totalMinutes).toBe(60);
	});

	it('message chart and the summaries cover the full 90 days', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db);
		const msgs = await getMessageActivityChart(db, G, '90d', null);
		expect(msgs.find((r: any) => r.date === day(60))?.messageCount).toBe(10);
		expect(msgs.find((r: any) => r.date === day(3))?.messageCount).toBe(5);

		const voice = await getVoiceActivitySummary(db, G, '90d');
		expect(voice.totalSeconds).toBe(7200 + 3600 + 3600);

		const growth = await getMemberGrowthSummary(db, G, '90d');
		expect(growth.joins).toBe(2 + 1 + 2);
	});
});
