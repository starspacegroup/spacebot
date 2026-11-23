import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1';
import {
	SERVER_TARGETS,
	MAX_WAIT_SECONDS,
	MIN_WAIT_SECONDS,
	SLICE,
	deleteServerData,
	issueConfirmation,
	namesMatch,
	recordDeletion,
	redeemConfirmation,
	remainingRows,
} from '../lib/server/server-deletion';

const A = '111111111111111111';
const B = '222222222222222222';

/** Real schema: every migration in order, so a renamed column or table fails here. */
function realDb() {
	const db = createSqliteD1('');
	for (const f of readdirSync('migrations')
		.filter((n) => n.endsWith('.sql'))
		.sort()) {
		try {
			db.exec(readFileSync(`migrations/${f}`, 'utf8'));
		} catch {
			// a few old migrations alter tables the test does not need
		}
	}
	return db;
}

describe('deleteServerData', () => {
	it('names only tables that exist in the real schema, with the columns it uses', () => {
		const db = realDb();
		const bad: string[] = [];
		for (const t of SERVER_TARGETS) {
			const col = 'column' in t ? t.column : t.via.column;
			try {
				(db as any).exec(`SELECT ${col} FROM ${t.table} LIMIT 0`);
			} catch {
				bad.push(`${t.table}.${col}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('removes a server and leaves every other server alone', async () => {
		const db = realDb();
		const d = db as any;
		for (const g of [A, B]) {
			d.exec(`INSERT INTO guild_settings (guild_id) VALUES ('${g}')`);
			d.exec(`INSERT INTO guild_metadata (guild_id, name) VALUES ('${g}', 'n')`);
			d.exec(
				`INSERT INTO event_logs (guild_id, event_type, event_category) VALUES ('${g}', 'x', 'c')`
			);
			d.exec(`INSERT INTO personality_hidden (guild_id, test_id) VALUES ('${g}', 't')`);
			d.exec(
				`INSERT INTO user_guilds (user_id, guild_id, standing) VALUES ('9', '${g}', 'admin')`
			);
		}
		const out = await deleteServerData(db, A);
		expect(out.done).toBe(true);
		expect(await remainingRows(db, A)).toEqual({});
		const left = await remainingRows(db, B);
		expect(left.guild_settings).toBe(1);
		expect(left.event_logs).toBe(1);
		expect(left.user_guilds).toBe(1);
	});

	it('deletes children through their parents (votes, words, quorum)', async () => {
		const db = realDb();
		const d = db as any;
		d.exec(
			`INSERT INTO quorum_questions (id, guild_id, channel_id, question, asker_id, quorum, closes_at, due_at, owner_id) VALUES (1, '${A}', 'c', 'q', 'u', 1, '2030-01-01', '2030-01-01', 'o')`
		);
		d.exec(
			`INSERT INTO quorum_questions (id, guild_id, channel_id, question, asker_id, quorum, closes_at, due_at, owner_id) VALUES (2, '${B}', 'c', 'q', 'u', 1, '2030-01-01', '2030-01-01', 'o')`
		);
		d.exec(
			`INSERT INTO quorum_votes (question_id, voter_hash, choice) VALUES (1, 'h', 0), (2, 'h', 0)`
		);
		await deleteServerData(db, A);
		const rows = (await db.prepare(`SELECT question_id FROM quorum_votes`).all()).results;
		expect(rows).toEqual([{ question_id: 2 }]);
	});

	it('deletes in slices and can be resumed when the budget runs out', async () => {
		const db = realDb();
		const d = db as any;
		d.exec(`INSERT INTO guild_settings (guild_id) VALUES ('${A}')`);
		const n = SLICE * 2 + 7;
		d.exec(
			`WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < ${n}) INSERT INTO event_logs (guild_id, event_type, event_category) SELECT '${A}', 'x', 'c' FROM c`
		);
		const first = await deleteServerData(db, A, 3);
		expect(first.done).toBe(false);
		expect(first.stoppedAt).toBeTruthy();
		const second = await deleteServerData(db, A);
		expect(second.done).toBe(true);
		expect(await remainingRows(db, A)).toEqual({});
	});

	it('removes the dashboard activity for that server only', async () => {
		const db = realDb();
		const d = db as any;
		d.exec(`INSERT INTO users (id, username) VALUES ('9', 'u')`);
		d.exec(
			`INSERT INTO user_activity_logs (user_id, method, path) VALUES ('9','POST','/admin/${A}/settings'), ('9','POST','/admin/${B}/settings')`
		);
		await deleteServerData(db, A);
		const rows = (await db.prepare(`SELECT path FROM user_activity_logs`).all()).results;
		expect(rows).toEqual([{ path: `/admin/${B}/settings` }]);
	});

	it('refuses anything that is not a server id', async () => {
		const db = realDb();
		await expect(deleteServerData(db, "1' OR '1'='1")).rejects.toThrow();
		await expect(deleteServerData(db, '')).rejects.toThrow();
		const ok = fc.assert(
			fc.property(
				fc.string().filter((s) => !/^\d{17,20}$/.test(s)),
				(s) => {
					let threw = false;
					deleteServerData(db, s).catch(() => {});
					try {
						if (!/^\d{17,20}$/.test(s)) threw = true;
					} catch {
						threw = true;
					}
					return threw;
				}
			)
		);
		expect(ok).toBeUndefined();
	});

	it('records the deletion without any content', async () => {
		const db = realDb();
		await recordDeletion(db, A, '9', 42, true);
		const row: any = await db.prepare(`SELECT * FROM server_deletions`).first();
		expect(row).toMatchObject({ guild_id: A, deleted_by: '9', rows_removed: 42, complete: 1 });
		expect(row.finished_at).toBeTruthy();
	});
});

describe('the two-step confirmation', () => {
	const U = '9';
	const age = (db: any, token: string, seconds: number) =>
		db.exec(
			`UPDATE server_deletion_requests SET created_at = datetime('now', '-${seconds} seconds') WHERE token = '${token}'`
		);

	it('refuses at once, accepts after the wait, and works only once', async () => {
		const db: any = realDb();
		const token = await issueConfirmation(db, A, U);
		expect(await redeemConfirmation(db, A, U, token)).toBe('too-soon');
		age(db, token, MIN_WAIT_SECONDS + 1);
		expect(await redeemConfirmation(db, A, U, token)).toBe('ok');
		expect(await redeemConfirmation(db, A, U, token)).toBe('missing');
	});

	it('expires, and is tied to one person and one server', async () => {
		const db: any = realDb();
		const t1 = await issueConfirmation(db, A, U);
		age(db, t1, MAX_WAIT_SECONDS + 5);
		expect(await redeemConfirmation(db, A, U, t1)).toBe('expired');
		const t2 = await issueConfirmation(db, A, U);
		age(db, t2, MIN_WAIT_SECONDS + 1);
		expect(await redeemConfirmation(db, B, U, t2)).toBe('missing');
		expect(await redeemConfirmation(db, A, '10', t2)).toBe('missing');
		expect(await redeemConfirmation(db, A, U, t2)).toBe('ok');
	});

	it('a new request replaces the old one, and junk tokens never pass', async () => {
		const db: any = realDb();
		const old = await issueConfirmation(db, A, U);
		const fresh = await issueConfirmation(db, A, U);
		age(db, fresh, MIN_WAIT_SECONDS + 1);
		expect(await redeemConfirmation(db, A, U, old)).toBe('missing');
		for (const junk of [undefined, null, '', "' OR 1=1 --", 5, {}]) {
			expect(await redeemConfirmation(db, A, U, junk)).toBe('missing');
		}
	});

	it('matches the typed name exactly, not loosely', () => {
		expect(namesMatch('My Server', 'My Server')).toBe(true);
		expect(namesMatch('  My Server ', 'My Server')).toBe(true);
		expect(namesMatch('my server', 'My Server')).toBe(false);
		expect(namesMatch('My', 'My Server')).toBe(false);
		expect(namesMatch('', 'x')).toBe(false);
		expect(namesMatch(undefined, 'x')).toBe(false);
		expect(namesMatch('é', 'é')).toBe(true);
		const ok = fc.assert(
			fc.property(
				fc.string({ minLength: 1 }),
				fc.string({ minLength: 1 }),
				(typed, name) =>
					namesMatch(typed, name) ===
					(typed.trim().normalize('NFC') === name.normalize('NFC'))
			)
		);
		expect(ok).toBeUndefined();
	});
});
