/**
 * Retention for the append-only tables, against real SQLite.
 */
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	LOG_RETENTION_TABLES,
	pruneAppendOnlyLogs,
	pruneTable,
	resolveTableRetention,
} from '../lib/db/log-retention.js';

const SCHEMA = `
	CREATE TABLE command_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, created_at DATETIME);
	CREATE TABLE ai_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, created_at TEXT);
	CREATE TABLE ai_job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL,
		created_at TEXT, FOREIGN KEY (job_id) REFERENCES ai_jobs(id));
	CREATE TABLE superadmin_workflow_cron_claims (template_id INTEGER NOT NULL,
		scheduled_minute TEXT NOT NULL, claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (template_id, scheduled_minute));
`;

const spec = (key: string) => LOG_RETENTION_TABLES.find((t) => t.key === key)!;
const count = async (db: any, t: string) =>
	Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first())?.n || 0);

function seedLogs(db: any, n: number, daysAgo: number) {
	for (let i = 0; i < n; i++)
		db.prepare(
			`INSERT INTO command_logs (guild_id, created_at) VALUES ('g', datetime('now', ?))`
		)
			.bind(`-${daysAgo} days`)
			.run();
}

describe('log retention', () => {
	it('deletes only expired rows and reports the oldest remaining age', async () => {
		const db = createSqliteD1(SCHEMA);
		seedLogs(db, 25, 200);
		seedLogs(db, 7, 5);
		const r = await pruneTable(db, spec('COMMAND_LOGS'), {
			days: 90,
			maxRows: 1000,
			batchSize: 4,
		});
		expect(r.deleted).toBe(25);
		expect(await count(db, 'command_logs')).toBe(7);
		expect(r.oldestRemainingDays).toBeGreaterThan(4);
		expect(r.oldestRemainingDays).toBeLessThan(6);
		db.close();
	});

	it('stops at its own budget and drains over runs', async () => {
		const db = createSqliteD1(SCHEMA);
		seedLogs(db, 30, 200);
		const r1 = await pruneTable(db, spec('COMMAND_LOGS'), {
			days: 90,
			maxRows: 10,
			batchSize: 4,
		});
		expect(r1.deleted).toBe(10);
		expect(r1.budgetExhausted).toBe(true);
		expect(r1.oldestRemainingDays).toBeGreaterThan(199);
		await pruneTable(db, spec('COMMAND_LOGS'), { days: 90, maxRows: 10, batchSize: 4 });
		await pruneTable(db, spec('COMMAND_LOGS'), { days: 90, maxRows: 10, batchSize: 4 });
		expect(await count(db, 'command_logs')).toBe(0);
		db.close();
	});

	it('maxRows 0 is a kill switch', async () => {
		const db = createSqliteD1(SCHEMA);
		seedLogs(db, 5, 200);
		const r = await pruneTable(db, spec('COMMAND_LOGS'), { days: 90, maxRows: 0 });
		expect(r.deleted).toBe(0);
		expect(await count(db, 'command_logs')).toBe(5);
		db.close();
	});

	it('keeps unfinished jobs and deletes events before their finished job', async () => {
		const db = createSqliteD1(SCHEMA);
		db.exec('PRAGMA foreign_keys = ON');
		let nextId = 0;
		const job = (status: string, days: number) => {
			db.prepare(`INSERT INTO ai_jobs (status, created_at) VALUES (?, datetime('now', ?))`)
				.bind(status, `-${days} days`)
				.run();
			return ++nextId;
		};
		const stuck = job('running', 120); // old but live: must stay, must not block
		const done = job('completed', 100);
		const failed = job('failed_terminal', 100);
		const fresh = job('completed', 1);
		for (const j of [stuck, done, failed, fresh])
			for (let i = 0; i < 3; i++)
				db.prepare(
					`INSERT INTO ai_job_events (job_id, created_at) VALUES (?, datetime('now'))`
				)
					.bind(j)
					.run();

		const r = await pruneTable(db, spec('AI_JOBS'), { days: 30, maxRows: 1000, batchSize: 1 });
		expect(r.error).toBeUndefined();
		expect(r.deleted).toBe(2);
		expect(r.childrenDeleted).toBe(6);
		const ids = (await db.prepare('SELECT id FROM ai_jobs ORDER BY id').all()).results.map(
			(x: any) => x.id
		);
		expect(ids).toEqual([stuck, fresh]);
		expect(await count(db, 'ai_job_events')).toBe(6);
		db.close();
	});

	it('prunes cron claims older than a day (rowid walk, composite key)', async () => {
		const db = createSqliteD1(SCHEMA);
		for (let i = 0; i < 5; i++)
			db.prepare(
				`INSERT INTO superadmin_workflow_cron_claims (template_id, scheduled_minute, claimed_at)
				 VALUES (1, ?, datetime('now', '-3 days'))`
			)
				.bind(`m${i}`)
				.run();
		db.prepare(
			`INSERT INTO superadmin_workflow_cron_claims (template_id, scheduled_minute) VALUES (1, 'now')`
		).run();
		const r = await pruneTable(db, spec('WORKFLOW_CRON_CLAIMS'), { days: 1, maxRows: 100 });
		expect(r.deleted).toBe(5);
		expect(await count(db, 'superadmin_workflow_cron_claims')).toBe(1);
		db.close();
	});

	it('one missing table does not stop the others', async () => {
		const db = createSqliteD1(SCHEMA); // most tables absent
		seedLogs(db, 3, 200);
		const results = await pruneAppendOnlyLogs(db);
		expect(results).toHaveLength(LOG_RETENTION_TABLES.length);
		expect(results.find((r) => r.table === 'command_logs')?.deleted).toBe(3);
		expect(results.find((r) => r.table === 'automation_logs')?.error).toBeTruthy();
		db.close();
	});

	it('reads env overrides and keeps 0 as a real value', () => {
		const platform = {
			env: {
				LOG_RETENTION_COMMAND_LOGS_DAYS: '14',
				LOG_RETENTION_COMMAND_LOGS_MAX_ROWS: '0',
			},
		};
		expect(resolveTableRetention(spec('COMMAND_LOGS'), platform)).toEqual({
			days: 14,
			maxRows: 0,
		});
		expect(resolveTableRetention(spec('COMMAND_LOGS'), { env: {} })).toEqual({
			days: 90,
			maxRows: 10000,
		});
	});
});
