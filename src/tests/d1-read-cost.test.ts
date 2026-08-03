/**
 * Guards against the query shapes that caused the D1 rows-read blowouts.
 *
 * These run against real SQLite because the whole point is what the engine does
 * with the SQL — a fake would just echo back the assumption being tested.
 */
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { DISTINCT_GUILD_IDS_SQL, GUILDS_WITH_RECENT_LOGS_SQL } from '../lib/db/distinct-guilds.js';

const SCHEMA = `
	CREATE TABLE event_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id TEXT,
		event_type TEXT,
		event_category TEXT,
		created_at DATETIME
	);
	CREATE INDEX idx_event_logs_guild_created ON event_logs(guild_id, created_at);
`;

function seedEvents(db: any, guildId: string, count: number, when = "datetime('now')") {
	for (let i = 0; i < count; i++) {
		db.prepare(
			`INSERT INTO event_logs (guild_id, event_type, event_category, created_at)
			 VALUES (?, 'MESSAGE_CREATE', 'message', ${when})`
		)
			.bind(guildId)
			.run();
	}
}

describe('distinct guild ids (loose index scan)', () => {
	it('returns exactly what SELECT DISTINCT would, without scanning every row', async () => {
		const db = createSqliteD1(SCHEMA);
		seedEvents(db, '111111111111111111', 40);
		seedEvents(db, '222222222222222222', 25);
		seedEvents(db, '333333333333333333', 10);

		const loose = (await db.prepare(DISTINCT_GUILD_IDS_SQL).all()).results.map(
			(r: any) => r.guild_id
		);
		const naive = (
			await db.prepare('SELECT DISTINCT guild_id FROM event_logs ORDER BY guild_id').all()
		).results.map((r: any) => r.guild_id);

		expect(loose.sort()).toEqual(naive.sort());
		expect(loose).toHaveLength(3);
		db.close();
	});

	it('handles an empty table without looping forever', async () => {
		const db = createSqliteD1(SCHEMA);
		const rows = (await db.prepare(DISTINCT_GUILD_IDS_SQL).all()).results;
		expect(rows).toEqual([]);
		db.close();
	});

	it('handles a single guild', async () => {
		const db = createSqliteD1(SCHEMA);
		seedEvents(db, '111111111111111111', 5);
		const rows = (await db.prepare(DISTINCT_GUILD_IDS_SQL).all()).results;
		expect(rows.map((r: any) => r.guild_id)).toEqual(['111111111111111111']);
		db.close();
	});

	it('reads far fewer rows than the naive DISTINCT it replaced', async () => {
		// The regression this guards: cost must scale with guilds, not events.
		const db = createSqliteD1(SCHEMA);
		seedEvents(db, '111111111111111111', 500);
		seedEvents(db, '222222222222222222', 500);

		const plan = (
			await db.prepare(`EXPLAIN QUERY PLAN ${DISTINCT_GUILD_IDS_SQL}`).all()
		).results
			.map((r: any) => r.detail)
			.join(' | ');

		// Every event_logs access must go through the index, never a table scan.
		expect(plan).not.toMatch(/SCAN event_logs(?! USING)/);
		expect(plan).toMatch(/idx_event_logs_guild_created|USING (COVERING )?INDEX/);
		db.close();
	});
});

describe('guilds with recent logs', () => {
	it('includes only guilds with an event inside the window', async () => {
		const db = createSqliteD1(SCHEMA);
		seedEvents(db, '111111111111111111', 5); // now
		seedEvents(db, '222222222222222222', 5, "datetime('now', '-30 days')"); // stale

		const rows = (await db.prepare(GUILDS_WITH_RECENT_LOGS_SQL).bind('-7 days').all()).results;
		expect(rows.map((r: any) => r.guild_id)).toEqual(['111111111111111111']);
		db.close();
	});

	it('returns nothing when every guild is outside the window', async () => {
		const db = createSqliteD1(SCHEMA);
		seedEvents(db, '111111111111111111', 5, "datetime('now', '-90 days')");
		const rows = (await db.prepare(GUILDS_WITH_RECENT_LOGS_SQL).bind('-7 days').all()).results;
		expect(rows).toEqual([]);
		db.close();
	});
});

describe('logs list: skippable pagination COUNT', () => {
	/**
	 * The logs page polls every 10s. With the count included, each poll ran
	 * `COUNT(*) ... WHERE guild_id = ?` over the largest table; the refresh must
	 * be able to opt out and pay only for the indexed LIMIT query.
	 */
	function countingDb(schema: string) {
		const db = createSqliteD1(schema);
		const seen: string[] = [];
		const realPrepare = db.prepare.bind(db);
		(db as any).prepare = (sql: string) => {
			seen.push(sql.replace(/\s+/g, ' ').trim());
			return realPrepare(sql);
		};
		return { db, seen };
	}

	it('runs no COUNT when includeTotal is false, and reports total as null', async () => {
		const { getLogs } = await import('../lib/db/logger.js');
		const { db, seen } = countingDb(SCHEMA);
		seedEvents(db, '111111111111111111', 30);

		const withCount = await getLogs(db, '111111111111111111', { limit: 5 });
		expect(withCount.total).toBe(30);
		expect(seen.some((s) => /COUNT\(\*\)/i.test(s))).toBe(true);

		seen.length = 0;
		const withoutCount = await getLogs(db, '111111111111111111', {
			limit: 5,
			includeTotal: false,
		});
		expect(withoutCount.logs).toHaveLength(5);
		// null, not 0 — callers must distinguish "not asked" from "empty".
		expect(withoutCount.total).toBeNull();
		expect(seen.some((s) => /COUNT\(\*\)/i.test(s))).toBe(false);
		db.close();
	});

	it('still counts by default, so nothing else that calls getLogs changes', async () => {
		const { getLogs } = await import('../lib/db/logger.js');
		const { db, seen } = countingDb(SCHEMA);
		seedEvents(db, '111111111111111111', 3);
		const result = await getLogs(db, '111111111111111111', {});
		expect(result.total).toBe(3);
		expect(seen.some((s) => /COUNT\(\*\)/i.test(s))).toBe(true);
		db.close();
	});
});
