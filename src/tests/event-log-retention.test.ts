/**
 * Retention must never delete history that isn't preserved in aggregate, and
 * must never become an expensive query itself. Both are properties of the SQL,
 * so these run against real SQLite.
 */
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { pruneAggregatedEventLogs, resolveGuildCutoff } from '../lib/db/event-log-retention.js';

const SCHEMA = `
	CREATE TABLE event_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id TEXT,
		event_type TEXT,
		created_at DATETIME
	);
	CREATE INDEX idx_event_logs_guild_created ON event_logs(guild_id, created_at);
	CREATE TABLE aggregated_stats (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id TEXT NOT NULL,
		period_type TEXT NOT NULL,
		period_start DATETIME NOT NULL,
		period_end DATETIME NOT NULL
	);
`;

const G1 = '111111111111111111';
const G2 = '222222222222222222';

function addEvents(db: any, guildId: string, count: number, daysAgo: number) {
	for (let i = 0; i < count; i++) {
		db.prepare(
			`INSERT INTO event_logs (guild_id, event_type, created_at)
			 VALUES (?, 'MESSAGE_CREATE', datetime('now', ?))`
		)
			.bind(guildId, `-${daysAgo} days`)
			.run();
	}
}

function addDailyAggregate(db: any, guildId: string, daysAgo: number) {
	db.prepare(
		`INSERT INTO aggregated_stats (guild_id, period_type, period_start, period_end)
		 VALUES (?, 'daily', datetime('now', ?), datetime('now', ?))`
	)
		.bind(guildId, `-${daysAgo} days`, `-${daysAgo - 1} days`)
		.run();
}

const countEvents = async (db: any, guildId?: string) =>
	Number(
		(
			await db
				.prepare(
					guildId
						? 'SELECT COUNT(*) AS n FROM event_logs WHERE guild_id = ?'
						: 'SELECT COUNT(*) AS n FROM event_logs'
				)
				[guildId ? 'bind' : 'bind'](...(guildId ? [guildId] : []))
				.first()
		)?.n || 0
	);

describe('event_logs retention safety', () => {
	it('never deletes a guild with no daily aggregate', async () => {
		// Its history exists nowhere else — a clock alone must not authorise deletion.
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 20, 200);

		const result = await pruneAggregatedEventLogs(db, { retentionDays: 90 });
		expect(result.deleted).toBe(0);
		expect(result.guildsSkipped).toBe(1);
		expect(await countEvents(db, G1)).toBe(20);
		db.close();
	});

	it('never deletes past the daily-aggregate watermark', async () => {
		// Aggregated only up to 150 days ago, but retention would allow 90.
		// The watermark must win, or the 90–150 day gap is lost with no record.
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 10, 200); // older than watermark → deletable
		addEvents(db, G1, 10, 120); // inside the un-aggregated gap → must survive
		addDailyAggregate(db, G1, 150);

		const result = await pruneAggregatedEventLogs(db, { retentionDays: 90 });
		expect(result.deleted).toBe(10);
		expect(await countEvents(db, G1)).toBe(10);
		db.close();
	});

	it('keeps everything inside the retention window even when fully aggregated', async () => {
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 15, 10);
		addDailyAggregate(db, G1, 1);

		const result = await pruneAggregatedEventLogs(db, { retentionDays: 90 });
		expect(result.deleted).toBe(0);
		expect(await countEvents(db, G1)).toBe(15);
		db.close();
	});

	it('deletes only what is both aged out and aggregated', async () => {
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 25, 200); // old + covered → goes
		addEvents(db, G1, 5, 3); // recent → stays
		addDailyAggregate(db, G1, 1);

		const result = await pruneAggregatedEventLogs(db, { retentionDays: 90 });
		expect(result.deleted).toBe(25);
		expect(await countEvents(db, G1)).toBe(5);
		db.close();
	});

	it('treats guilds independently — one unaggregated guild cannot stall another', async () => {
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 12, 200);
		addDailyAggregate(db, G1, 1);
		addEvents(db, G2, 12, 200); // no aggregate at all

		const result = await pruneAggregatedEventLogs(db, { retentionDays: 90 });
		expect(await countEvents(db, G1)).toBe(0);
		expect(await countEvents(db, G2)).toBe(12);
		expect(result.guildsProcessed).toBe(1);
		expect(result.guildsSkipped).toBe(1);
		db.close();
	});

	it('leaves aggregates alone — the long-term record is untouched', async () => {
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 10, 200);
		addDailyAggregate(db, G1, 1);
		await pruneAggregatedEventLogs(db, { retentionDays: 90 });
		const aggregates = Number(
			(await db.prepare('SELECT COUNT(*) AS n FROM aggregated_stats').first())?.n || 0
		);
		expect(aggregates).toBe(1);
		db.close();
	});
});

describe('event_logs retention cost control', () => {
	it('stops at the per-run budget so a backlog drains over several nights', async () => {
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 50, 200);
		addDailyAggregate(db, G1, 1);

		const first = await pruneAggregatedEventLogs(db, {
			retentionDays: 90,
			batchSize: 10,
			maxRowsPerRun: 20,
		});
		expect(first.deleted).toBe(20);
		expect(first.budgetExhausted).toBe(true);
		expect(await countEvents(db, G1)).toBe(30);

		// A later run picks up exactly where it left off.
		const second = await pruneAggregatedEventLogs(db, {
			retentionDays: 90,
			batchSize: 10,
			maxRowsPerRun: 20,
		});
		expect(second.deleted).toBe(20);
		expect(await countEvents(db, G1)).toBe(10);
		db.close();
	});

	it('never exceeds the budget even with a batch size larger than it', async () => {
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 100, 200);
		addDailyAggregate(db, G1, 1);
		const result = await pruneAggregatedEventLogs(db, {
			retentionDays: 90,
			batchSize: 5000,
			maxRowsPerRun: 7,
		});
		expect(result.deleted).toBe(7);
		db.close();
	});

	it('deletes through an index rather than scanning event_logs', async () => {
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 30, 200);
		const plan = (
			await db
				.prepare(
					`EXPLAIN QUERY PLAN
					 SELECT id FROM event_logs WHERE guild_id = ? AND created_at < ? ORDER BY id LIMIT ?`
				)
				.bind(G1, '2020-01-01 00:00:00', 10)
				.all()
		).results
			.map((r: any) => r.detail)
			.join(' | ');
		expect(plan).toMatch(/idx_event_logs_guild_created/);
		expect(plan).not.toMatch(/SCAN event_logs(?! USING)/);
		db.close();
	});

	it('falls back to the default budget on a garbage value, but honours an explicit 0', async () => {
		// Number('abc') is NaN, not nullish — an unguarded coercion sent `LIMIT NaN`.
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 5, 200);
		addDailyAggregate(db, G1, 1);
		const result = await pruneAggregatedEventLogs(db, {
			retentionDays: 90,
			maxRowsPerRun: 'not-a-number' as any,
		});
		expect(result.deleted).toBe(5);
		db.close();
	});

	it('does nothing at all when the budget is zero', async () => {
		const db = createSqliteD1(SCHEMA);
		addEvents(db, G1, 10, 200);
		addDailyAggregate(db, G1, 1);
		const result = await pruneAggregatedEventLogs(db, { maxRowsPerRun: 0 });
		expect(result.deleted).toBe(0);
		expect(await countEvents(db, G1)).toBe(10);
		db.close();
	});
});

describe('resolveGuildCutoff', () => {
	it('returns null without a daily aggregate', async () => {
		const db = createSqliteD1(SCHEMA);
		expect(await resolveGuildCutoff(db, G1, '2026-01-01 00:00:00')).toBeNull();
		db.close();
	});

	it('picks whichever of watermark and retention cutoff is earlier', async () => {
		const db = createSqliteD1(SCHEMA);
		db.prepare(
			`INSERT INTO aggregated_stats (guild_id, period_type, period_start, period_end)
			 VALUES (?, 'daily', '2026-01-01 00:00:00', '2026-01-02 00:00:00')`
		)
			.bind(G1)
			.run();

		// Watermark older than retention → watermark wins.
		expect(await resolveGuildCutoff(db, G1, '2026-06-01 00:00:00')).toBe('2026-01-02 00:00:00');
		// Retention older than watermark → retention wins.
		expect(await resolveGuildCutoff(db, G1, '2025-06-01 00:00:00')).toBe('2025-06-01 00:00:00');
		db.close();
	});
});
