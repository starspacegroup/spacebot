import { describe, it, expect } from 'vitest';
import {
	countAIJobRequeues,
	deferAIJobRetry,
	MAX_WATCHDOG_REQUEUES,
	watchdogBackoffMinutes,
} from '../lib/db/ai-orchestration.js';

/**
 * Watchdog requeue policy (2026-07-24 Queues-limit incident): the sweep used
 * to re-enqueue every due pending job with no backoff or cap — a stuck job
 * cost ~860 queue operations/day against the free tier's 10,000. These tests
 * pin the policy: exponential backoff, a hard requeue cap, and the defer
 * update that stops a job from being due for every 5-minute sweep.
 */

function fakeDb(opts: { firstRow?: any; onRun?: (sql: string, binds: any[]) => void } = {}) {
	const calls: { sql: string; binds: any[] }[] = [];
	const db = {
		calls,
		prepare(sql: string) {
			const stmt: any = {
				binds: [] as any[],
				bind(...args: any[]) {
					stmt.binds = args;
					return stmt;
				},
				async first() {
					calls.push({ sql, binds: stmt.binds });
					return opts.firstRow ?? null;
				},
				async run() {
					calls.push({ sql, binds: stmt.binds });
					opts.onRun?.(sql, stmt.binds);
					return { meta: { changes: 1 } };
				},
				async all() {
					calls.push({ sql, binds: stmt.binds });
					return { results: [] };
				},
			};
			return stmt;
		},
	};
	return db as any;
}

describe('watchdogBackoffMinutes', () => {
	it('doubles from 5 minutes per prior requeue', () => {
		expect(watchdogBackoffMinutes(0)).toBe(5);
		expect(watchdogBackoffMinutes(1)).toBe(10);
		expect(watchdogBackoffMinutes(2)).toBe(20);
		expect(watchdogBackoffMinutes(3)).toBe(40);
		expect(watchdogBackoffMinutes(5)).toBe(160);
	});

	it('caps at one day and tolerates junk input', () => {
		expect(watchdogBackoffMinutes(20)).toBe(1440);
		expect(watchdogBackoffMinutes(-3)).toBe(5);
		expect(watchdogBackoffMinutes(undefined)).toBe(5);
		expect(watchdogBackoffMinutes(NaN)).toBe(5);
	});

	it('keeps total pre-cap requeues cheap: the capped budget beats one uncapped day', () => {
		// Old behavior: 288 requeues/day/job. New: at most MAX_WATCHDOG_REQUEUES
		// requeues spread over ever-longer gaps — the whole lifetime budget is
		// smaller than one hour of the old loop.
		expect(MAX_WATCHDOG_REQUEUES).toBeLessThan(12);
	});
});

describe('countAIJobRequeues', () => {
	it("counts the job's job.requeued audit events", async () => {
		const db = fakeDb({ firstRow: { n: 4 } });
		expect(await countAIJobRequeues(db, 77)).toBe(4);
		expect(db.calls[0].sql).toContain("event_type = 'job.requeued'");
		expect(db.calls[0].binds).toEqual([77]);
	});

	it('returns 0 with no db, no job, or a query error', async () => {
		expect(await countAIJobRequeues(null, 1)).toBe(0);
		expect(await countAIJobRequeues(fakeDb(), null)).toBe(0);
		const throwing = {
			prepare() {
				throw new Error('boom');
			},
		};
		expect(await countAIJobRequeues(throwing as any, 1)).toBe(0);
	});
});

describe('deferAIJobRetry', () => {
	it('pushes next_retry_at forward only for still-pending jobs', async () => {
		let seen: { sql: string; binds: any[] } | null = null;
		const db = fakeDb({ onRun: (sql, binds) => (seen = { sql, binds }) });
		const res = await deferAIJobRetry(db, 42, 20);
		expect(res.success).toBe(true);
		expect(seen!.sql).toContain("status = 'pending'");
		expect(seen!.sql).toContain('next_retry_at');
		expect(seen!.binds).toEqual([20, 42]);
	});

	it('clamps minutes into [1, 1440]', async () => {
		let binds: any[] = [];
		const db = fakeDb({ onRun: (_sql, b) => (binds = b) });
		await deferAIJobRetry(db, 1, 999999);
		expect(binds[0]).toBe(1440);
		await deferAIJobRetry(db, 1, 0);
		expect(binds[0]).toBe(1);
		await deferAIJobRetry(db, 1, undefined as any);
		expect(binds[0]).toBe(5);
	});

	it('fails soft with no db and on query error', async () => {
		expect((await deferAIJobRetry(null, 1, 5)).success).toBe(false);
		const throwing = {
			prepare() {
				throw new Error('boom');
			},
		};
		expect((await deferAIJobRetry(throwing as any, 1, 5)).success).toBe(false);
	});
});
