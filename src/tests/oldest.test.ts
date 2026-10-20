import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	formatAge,
	handleOldestCommand,
	loadRoster,
	renderRoster,
	snowflakeToDate,
} from '../lib/server/oldest.js';

const SCHEMA = `
CREATE TABLE guild_members_cache (
	guild_id TEXT NOT NULL, user_id TEXT NOT NULL, is_bot INTEGER DEFAULT 0,
	joined_at DATETIME DEFAULT NULL, PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE guild_cache_metadata (guild_id TEXT PRIMARY KEY, members_last_refreshed DATETIME);
`;

// 17-, 18- and 19-digit ids. As text they sort 1.., 3.., 9.. : the newest first.
const OLD_17 = '96008815106887111'; // 2016
const MID_18 = '300000000000000000'; // 2017
const NEW_19 = '1420070400000000000'; // 2025

function seed(rows: Array<[string, string, number?, string?]>, refreshed: string | null = null) {
	const db = createSqliteD1(SCHEMA);
	for (const [guild, user, bot = 0, joined = null] of rows) {
		db.exec(
			`INSERT INTO guild_members_cache (guild_id, user_id, is_bot, joined_at)
			 VALUES ('${guild}', '${user}', ${bot}, ${joined ? `'${joined}'` : 'NULL'})`
		);
	}
	if (refreshed) {
		db.exec(`INSERT INTO guild_cache_metadata VALUES ('g1', '${refreshed}')`);
	}
	return db;
}

describe('snowflakeToDate', () => {
	it('reads the creation time out of the id', () => {
		// The documented example id from Discord's own docs: 2016-04-30 11:18:25 UTC.
		expect(snowflakeToDate('175928847299117063')?.toISOString()).toBe(
			'2016-04-30T11:18:25.796Z'
		);
	});
	it('refuses things that are not snowflakes', () => {
		expect(snowflakeToDate('abc')).toBeNull();
		expect(snowflakeToDate('')).toBeNull();
	});
});

describe('formatAge', () => {
	it('uses whole years and months, then days', () => {
		const now = new Date('2026-10-15T00:00:00Z');
		expect(formatAge(new Date('2015-03-12T00:00:00Z'), now)).toBe('11 years 7 months');
		expect(formatAge(new Date('2026-07-20T00:00:00Z'), now)).toBe('2 months');
		expect(formatAge(new Date('2026-10-10T00:00:00Z'), now)).toBe('5 days');
	});
});

describe('loadRoster', () => {
	it('puts the oldest account first even though its id sorts last as text', async () => {
		const db = seed([
			['g1', NEW_19],
			['g1', OLD_17],
			['g1', MID_18],
		]);
		const r = await loadRoster(db, 'g1', 'account');
		expect(r.state).toBe('ok');
		if (r.state === 'ok') {
			expect(r.entries.map((e) => e.user_id)).toEqual([OLD_17, MID_18, NEW_19]);
		}
	});

	it('reverses for newest', async () => {
		const db = seed([
			['g1', OLD_17],
			['g1', NEW_19],
			['g1', MID_18],
		]);
		const r = await loadRoster(db, 'g1', 'newest');
		if (r.state === 'ok') {
			expect(r.entries.map((e) => e.user_id)).toEqual([NEW_19, MID_18, OLD_17]);
		}
	});

	it('leaves bots and other servers out', async () => {
		const db = seed([
			['g1', OLD_17, 1],
			['g2', OLD_17],
			['g1', MID_18],
		]);
		const r = await loadRoster(db, 'g1', 'account');
		expect(r.state === 'ok' && r.entries.map((e) => e.user_id)).toEqual([MID_18]);
		expect(r.state === 'ok' && r.total).toBe(1);
	});

	it('ranks by join date for members, skipping unknown joins', async () => {
		const db = seed([
			['g1', OLD_17, 0, '2024-05-01 10:00:00'],
			['g1', MID_18, 0, '2021-01-01T00:00:00.000000+00:00'],
			['g1', NEW_19, 0, null],
		]);
		const r = await loadRoster(db, 'g1', 'members');
		expect(r.state === 'ok' && r.entries.map((e) => e.user_id)).toEqual([MID_18, OLD_17]);
	});

	it('limits to ten', async () => {
		const rows: Array<[string, string]> = [];
		for (let i = 0; i < 15; i++) rows.push(['g1', String(300000000000000000n + BigInt(i))]);
		const r = await loadRoster(seed(rows), 'g1', 'account');
		expect(r.state === 'ok' && r.entries.length).toBe(10);
		expect(r.state === 'ok' && r.total).toBe(15);
	});

	it('tells never-synced from refreshing', async () => {
		expect((await loadRoster(seed([]), 'g1', 'account')).state).toBe('never_synced');
		expect((await loadRoster(seed([], '2026-10-15 09:00:00'), 'g1', 'account')).state).toBe(
			'refreshing'
		);
	});
});

describe('handleOldestCommand', () => {
	const now = new Date('2026-10-15T10:00:00Z');
	const body = (show?: string) => ({
		guild_id: 'g1',
		data: { name: 'oldest', options: show ? [{ name: 'show', value: show }] : [] },
	});

	it('answers publicly with the age and cache age, and pings nobody', async () => {
		const db = seed([['g1', OLD_17]], '2026-10-15 09:46:00');
		const res = await handleOldestCommand(body(), db, now);
		expect(res.data.flags).toBeUndefined();
		expect(res.data.allowed_mentions).toEqual({ parse: [] });
		expect(res.data.content).toContain(`<@${OLD_17}>`);
		expect(res.data.content).toContain('Member list as of 14 minutes ago');
	});

	it('answers privately when there is nothing to show', async () => {
		const res = await handleOldestCommand(body(), seed([]), now);
		expect(res.data.flags).toBe(64);
		expect(res.data.content).toContain('not been synced');
	});

	it('tells the caller their own place, ordered by number not text', async () => {
		const db = seed([
			['g1', NEW_19],
			['g1', OLD_17],
			['g1', MID_18],
		]);
		const ask = (show: string | undefined, id: string) =>
			handleOldestCommand({ ...body(show), member: { user: { id } } }, db, now);
		expect((await ask(undefined, NEW_19)).data.content).toContain('You are #3 of 3.');
		expect((await ask('newest', NEW_19)).data.content).toContain('You are #1 of 3.');
		expect((await ask(undefined, OLD_17)).data.content).toContain('You are #1 of 3.');
	});

	it('ranks the caller by join date for members', async () => {
		const db = seed([
			['g1', OLD_17, 0, '2024-05-01 10:00:00'],
			['g1', MID_18, 0, '2021-01-01 00:00:00'],
		]);
		const res = await handleOldestCommand(
			{ ...body('members'), member: { user: { id: OLD_17 } } },
			db,
			now
		);
		expect(res.data.content).toContain('You are #2 of 2.');
	});

	it('says nothing about rank for a bot, a stranger, or no caller', async () => {
		const db = seed([
			['g1', OLD_17, 1],
			['g1', MID_18],
		]);
		for (const id of [OLD_17, NEW_19, undefined]) {
			const res = await handleOldestCommand(
				{ ...body(), member: id ? { user: { id } } : undefined },
				db,
				now
			);
			expect(res.data.content).not.toContain('You are');
		}
	});

	it('renders the refreshing state', () => {
		expect(renderRoster({ state: 'refreshing' }, 'account', now)).toContain('being refreshed');
	});
});

describe('migration', () => {
	it('seeds /oldest as an enabled built-in that is not always-on', () => {
		const sql = readFileSync(
			new URL('../../migrations/0075_oldest_command.sql', import.meta.url),
			'utf8'
		);
		expect(sql).toContain("'__built_in__', 'oldest'");
		const options = JSON.parse(/'(\[\{"name":"show".*?\}\])',/s.exec(sql)![1]);
		expect(options[0].choices.map((c) => c.value)).toEqual(['account', 'newest', 'members']);
	});
});
