import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { claimMessageForSending } from '../lib/db/scheduled-messages.js';

const migration = readFileSync('migrations/0079_workflow_concurrency.sql', 'utf8');

describe('workflow / scheduler concurrency (security #9)', () => {
	it('the cron claim primary key lets exactly one tick win a minute', async () => {
		const db = createSqliteD1(
			`CREATE TABLE superadmin_workflow_runs (id INTEGER PRIMARY KEY);\n${migration}`
		);
		const claim = () =>
			db
				.prepare(
					`INSERT OR IGNORE INTO superadmin_workflow_cron_claims (template_id, scheduled_minute) VALUES (?, ?)`
				)
				.bind(1, '2026-10-20 12:00:00')
				.run();
		const results = await Promise.all([claim(), claim(), claim()]);
		expect(results.filter((r) => r.meta.changes === 1)).toHaveLength(1);
	});

	it('the run lease is exclusive until released', async () => {
		const db = createSqliteD1(
			`CREATE TABLE superadmin_workflow_runs (id INTEGER PRIMARY KEY);\n${migration}\nINSERT INTO superadmin_workflow_runs (id) VALUES (1);`
		);
		const acquire = () =>
			db
				.prepare(
					`UPDATE superadmin_workflow_runs SET lease_until = datetime('now', ?) WHERE id = ? AND (lease_until IS NULL OR lease_until <= datetime('now'))`
				)
				.bind('+900 seconds', 1)
				.run();
		expect((await acquire()).meta.changes).toBe(1);
		expect((await acquire()).meta.changes).toBe(0);
	});

	it('a scheduled message is claimed by exactly one sender', async () => {
		const db = createSqliteD1(
			`CREATE TABLE scheduled_messages (id INTEGER PRIMARY KEY, status TEXT, updated_at TEXT);
			 INSERT INTO scheduled_messages (id, status) VALUES (1, 'pending');`
		);
		const wins = await Promise.all([
			claimMessageForSending(db, 1),
			claimMessageForSending(db, 1),
		]);
		expect(wins.filter(Boolean)).toHaveLength(1);
	});
});
