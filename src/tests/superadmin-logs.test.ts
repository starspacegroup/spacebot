import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createSqliteD1 } from './helpers/sqlite-d1';
import {
	MAX_HOURS,
	MAX_LIMIT,
	activityFeed,
	auditTrail,
	cleanFilter,
	describeRequest,
	errorFeed,
	guildOfPath,
	scopeOfPath,
	userTimeline,
} from '../lib/server/superadmin-logs';

const SCHEMA = `
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
CREATE TABLE user_activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, activity_type TEXT DEFAULT 'action',
  method TEXT, path TEXT, query_string TEXT, status_code INTEGER, created_at TEXT);
CREATE TABLE commands (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE command_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, command_id INTEGER, guild_id TEXT, user_id TEXT, user_name TEXT,
  success INTEGER DEFAULT 1, error_message TEXT, execution_time_ms INTEGER, created_at TEXT);
CREATE TABLE event_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, event_type TEXT, event_category TEXT,
  actor_id TEXT, actor_name TEXT, target_name TEXT, channel_name TEXT, created_at TEXT);
CREATE TABLE automation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, trigger_event TEXT, success INTEGER DEFAULT 1,
  error_message TEXT, created_at TEXT);
CREATE TABLE guild_command_sync (guild_id TEXT PRIMARY KEY, attempted_at TEXT, last_error TEXT);
CREATE TABLE gateway_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, message TEXT, source TEXT, logged_at TEXT);`;

const G1 = '111111111111111111';
const G2 = '222222222222222222';
const NOW = new Date('2026-11-21T12:00:00Z');
const T = (m: number) =>
	new Date(NOW.getTime() - m * 60_000).toISOString().replace('T', ' ').slice(0, 19);

let db: any;
const run = (sql: string, ...b: unknown[]) =>
	db
		.prepare(sql)
		.bind(...b)
		.run();

beforeEach(async () => {
	db = createSqliteD1(SCHEMA);
	await run(`INSERT INTO users VALUES ('7', 'davis'), ('8', 'amy')`);
	await run(`INSERT INTO commands VALUES (1, 'topic'), (2, 'personality')`);
	const act = `INSERT INTO user_activity_logs (user_id, method, path, query_string, status_code, created_at) VALUES (?,?,?,?,?,?)`;
	await run(act, '7', 'POST', `/admin/${G1}/personality`, '?/enable', 200, T(5));
	await run(act, '7', 'GET', `/admin/${G1}/personality`, null, 200, T(6));
	await run(act, '8', 'POST', `/api/superadmin/users/7`, null, 500, T(7));
	await run(act, '8', 'POST', `/admin/${G2}/settings`, '?/save', 200, T(8));
	await run(act, '7', 'POST', `/admin/${G1}/old`, null, 200, T(60 * 24 * 30));
	const cmd = `INSERT INTO command_logs (command_id, guild_id, user_id, user_name, success, error_message, created_at) VALUES (?,?,?,?,?,?,?)`;
	await run(cmd, 1, G1, '7', 'davis', 1, null, T(2));
	await run(cmd, 2, G2, '8', 'amy', 0, 'No search', T(3));
	await run(
		`INSERT INTO event_logs (guild_id, event_type, event_category, actor_id, actor_name, created_at) VALUES (?,?,?,?,?,?)`,
		G1,
		'member_join',
		'members',
		'7',
		'davis',
		T(4)
	);
	await run(
		`INSERT INTO automation_logs (guild_id, trigger_event, success, error_message, created_at) VALUES (?,?,?,?,?)`,
		G1,
		'message',
		0,
		'Missing permission',
		T(9)
	);
	await run(`INSERT INTO guild_command_sync VALUES (?,?,?)`, G2, T(10), 'Discord API error');
	await run(`INSERT INTO guild_command_sync VALUES (?,?,?)`, G1, T(10), null);
	await run(
		`INSERT INTO gateway_logs (level, message, source, logged_at) VALUES ('error', 'socket closed', 'gateway', ?), ('info', 'ok', 'gateway', ?)`,
		T(11),
		T(11)
	);
});

describe('request helpers', () => {
	it('finds the server and the part of the site', () => {
		expect(guildOfPath(`/admin/${G1}/logs`)).toBe(G1);
		expect(guildOfPath(`/api/commands/${G1}`)).toBe(G1);
		expect(guildOfPath('/admin/superadmin/users')).toBeNull();
		expect(scopeOfPath('/api/superadmin/users/7')).toBe('superadmin');
		expect(scopeOfPath(`/admin/${G1}/x`)).toBe('server');
		expect(scopeOfPath('/account')).toBe('account');
		expect(scopeOfPath('/status')).toBe('other');
		expect(describeRequest('post', `/admin/${G1}/p`, '?/enable&x=1')).toBe(
			`POST /admin/${G1}/p ?/enable`
		);
		expect(describeRequest('GET', '/a', '?secret=1')).toBe('GET /a');
	});

	it('cleanFilter always returns a safe filter', () => {
		fc.assert(
			fc.property(
				fc.anything(),
				fc.anything(),
				fc.anything(),
				fc.anything(),
				fc.anything(),
				(guildId, userId, hours, limit, before) => {
					const f = cleanFilter({ guildId, userId, hours, limit, before } as any);
					return (
						f.hours >= 1 &&
						f.hours <= MAX_HOURS &&
						f.limit >= 1 &&
						f.limit <= MAX_LIMIT &&
						(f.guildId === undefined || /^\d{17,20}$/.test(f.guildId)) &&
						(f.userId === undefined || /^\d{1,25}$/.test(f.userId)) &&
						(f.before === undefined ||
							/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(f.before))
					);
				}
			)
		);
	});
});

describe('audit trail', () => {
	it('lists writes only, newest first, inside the window', async () => {
		const rows = await auditTrail(db, {}, NOW);
		expect(rows.map((r) => r.title)).toEqual([
			`POST /admin/${G1}/personality ?/enable`,
			`POST /api/superadmin/users/7`,
			`POST /admin/${G2}/settings ?/save`,
		]);
		expect(rows[0]).toMatchObject({
			user_name: 'davis',
			kind: 'server',
			guild_id: G1,
			ok: true,
		});
		expect(rows[1]).toMatchObject({ kind: 'superadmin', ok: false, detail: 'HTTP 500' });
		expect((await auditTrail(db, { hours: 24 * 31 }, NOW)).length).toBe(4);
	});

	it('filters by server and by person, and pages with before', async () => {
		expect((await auditTrail(db, { guildId: G2 }, NOW)).map((r) => r.user_name)).toEqual([
			'amy',
		]);
		expect((await auditTrail(db, { userId: '8' }, NOW)).length).toBe(2);
		const first = await auditTrail(db, { limit: 1 }, NOW);
		const next = await auditTrail(db, { limit: 1, before: first[0].at }, NOW);
		expect(next[0].key).not.toBe(first[0].key);
	});

	it('treats a hostile filter as plain data', async () => {
		const rows = await auditTrail(db, { guildId: `1' OR '1'='1`, userId: `7' OR 1=1 --` }, NOW);
		expect(rows.length).toBe(3);
	});
});

describe('activity and errors', () => {
	it('merges commands and events from every server, newest first', async () => {
		const rows = await activityFeed(db, {}, NOW);
		expect(rows.map((r) => r.title)).toEqual(['/topic', '/personality', 'member_join']);
		expect(rows[1]).toMatchObject({ ok: false, detail: 'No search', guild_id: G2 });
		expect((await activityFeed(db, { guildId: G1 }, NOW)).map((r) => r.title)).toEqual([
			'/topic',
			'member_join',
		]);
	});

	it('collects every kind of failure and leaves successes out', async () => {
		const rows = await errorFeed(db, {}, NOW);
		expect(rows.map((r) => r.kind).sort()).toEqual([
			'automation',
			'bot',
			'command',
			'request',
			'sync',
		]);
		expect(rows.every((r) => r.ok === false)).toBe(true);
		expect(rows.find((r) => r.kind === 'sync')).toMatchObject({
			guild_id: G2,
			detail: 'Discord API error',
		});
	});

	it('one server leaves out bot-wide errors, one person leaves out server-only ones', async () => {
		expect((await errorFeed(db, { guildId: G1 }, NOW)).map((r) => r.kind)).toEqual([
			'automation',
		]);
		expect((await errorFeed(db, { userId: '8' }, NOW)).map((r) => r.kind).sort()).toEqual([
			'command',
			'request',
		]);
	});
});

describe('user timeline', () => {
	it('mixes dashboard requests and commands for one person only', async () => {
		const rows = await userTimeline(db, '7', {}, NOW);
		expect(rows.map((r) => r.title)).toEqual([
			'/topic',
			`POST /admin/${G1}/personality ?/enable`,
			`GET /admin/${G1}/personality`,
		]);
		expect(rows.find((r) => r.kind === 'view')).toBeTruthy();
		expect(rows.every((r) => r.user_id === '7')).toBe(true);
	});

	it('refuses a bad user id and a missing database', async () => {
		expect(await userTimeline(db, `7' OR 1=1`, {}, NOW)).toEqual([]);
		expect(await userTimeline(null, '7')).toEqual([]);
		expect(await auditTrail(null)).toEqual([]);
	});
});
