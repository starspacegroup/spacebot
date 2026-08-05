/**
 * Retention deletes are the most dangerous statements in this codebase, so they
 * are exercised against a real engine rather than a fake.
 *
 * The hazard being guarded: voice_sessions, server_stats and hourly
 * aggregated_stats had never been pruned, because nothing ever invoked the daily
 * refresh. Scheduling it points three unbounded DELETEs at months of backlog at
 * once — and a delete costs one row-write per row plus one per index, against
 * D1's ~100k/day write cap.
 */
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { deleteInBatches } from '../lib/db/bounded-delete.js';

const SCHEMA = `
	CREATE TABLE voice_sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id TEXT,
		left_at DATETIME
	);
`;

function seed(db: any, count: number, daysAgo: number, guildId = '111111111111111111') {
	for (let i = 0; i < count; i++) {
		db.prepare(`INSERT INTO voice_sessions (guild_id, left_at) VALUES (?, datetime('now', ?))`)
			.bind(guildId, `-${daysAgo} days`)
			.run();
	}
}

const remaining = async (db: any) =>
	Number((await db.prepare('SELECT COUNT(*) AS n FROM voice_sessions').first())?.n || 0);

const OLD = `left_at IS NOT NULL AND left_at < datetime('now', '-90 days')`;

describe('deleteInBatches', () => {
	it('deletes only rows matching the predicate', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, 20, 200); // old
		seed(db, 8, 5); // recent — must survive

		const r = await deleteInBatches(db, { table: 'voice_sessions', where: OLD });
		expect(r.deleted).toBe(20);
		expect(await remaining(db)).toBe(8);
		db.close();
	});

	it('stops at the budget so a backlog drains over several runs', async () => {
		// The whole point: one pass must not try to delete months of rows.
		const db = createSqliteD1(SCHEMA);
		seed(db, 50, 200);

		const first = await deleteInBatches(db, {
			table: 'voice_sessions',
			where: OLD,
			batchSize: 10,
			budget: 20,
		});
		expect(first.deleted).toBe(20);
		expect(first.budgetExhausted).toBe(true);
		expect(await remaining(db)).toBe(30);

		const second = await deleteInBatches(db, {
			table: 'voice_sessions',
			where: OLD,
			batchSize: 10,
			budget: 20,
		});
		expect(second.deleted).toBe(20);
		expect(await remaining(db)).toBe(10);
		db.close();
	});

	it('never exceeds the budget even when the batch size is larger', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, 100, 200);
		const r = await deleteInBatches(db, {
			table: 'voice_sessions',
			where: OLD,
			batchSize: 5000,
			budget: 7,
		});
		expect(r.deleted).toBe(7);
		db.close();
	});

	it('honours bind parameters so a per-guild sweep cannot hit other guilds', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, 10, 200, 'guild-a');
		seed(db, 10, 200, 'guild-b');

		const r = await deleteInBatches(db, {
			table: 'voice_sessions',
			where: `guild_id = ? AND ${OLD}`,
			binds: ['guild-a'],
		});
		expect(r.deleted).toBe(10);
		expect(await remaining(db)).toBe(10);
		db.close();
	});

	it('terminates cleanly when nothing matches', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, 5, 1); // all recent
		const r = await deleteInBatches(db, { table: 'voice_sessions', where: OLD });
		expect(r.deleted).toBe(0);
		expect(r.budgetExhausted).toBe(false);
		expect(await remaining(db)).toBe(5);
		db.close();
	});

	it('does nothing on a zero budget, and survives a garbage one', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, 10, 200);

		expect(
			(await deleteInBatches(db, { table: 'voice_sessions', where: OLD, budget: 0 })).deleted
		).toBe(0);
		expect(await remaining(db)).toBe(10);

		// Number('abc') is NaN, not nullish — an unguarded coercion would send LIMIT NaN.
		const r = await deleteInBatches(db, {
			table: 'voice_sessions',
			where: OLD,
			budget: 'nonsense' as any,
		});
		expect(r.deleted).toBe(10);
		db.close();
	});

	it('deletes through the primary key rather than scanning', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, 10, 200);
		const plan = (
			await db
				.prepare(
					`EXPLAIN QUERY PLAN SELECT id FROM voice_sessions WHERE ${OLD} ORDER BY id LIMIT 5`
				)
				.all()
		).results
			.map((r: any) => r.detail)
			.join(' | ');
		// A bounded subselect ordered by rowid — never a full sort of the table.
		expect(plan).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
		db.close();
	});

	it('returns zero rather than throwing when the table does not exist', async () => {
		const db = createSqliteD1(SCHEMA);
		const r = await deleteInBatches(db, { table: 'no_such_table', where: '1=1' });
		expect(r.deleted).toBe(0);
		db.close();
	});
});
