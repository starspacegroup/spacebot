/**
 * getRoleMemberCounts, against real SQLite and the real cache schema.
 *
 * The behaviour lives in the SQL — json_each over a JSON column, a guard for a
 * row whose JSON is broken, and which roles and accounts are left out — so a
 * hand-written fake would only be testing itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/log.js', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getRoleMemberCounts } from '$lib/db/guild-cache.js';
import { createSqliteD1, type SqliteD1 } from './helpers/sqlite-d1';

const GUILD = '100000000000000001';
const PASSENGER = '200000000000000001';
const BADGE = '200000000000000002';
const BOTS = '200000000000000003';

const schema = readFileSync(join(__dirname, '../../migrations/0014_member_role_cache.sql'), 'utf8');

let db: SqliteD1;

function role(id: string, name: string, position: number, managed = 0) {
	db.prepare(
		'INSERT INTO guild_roles_cache (guild_id, role_id, name, position, managed) VALUES (?, ?, ?, ?, ?)'
	)
		.bind(GUILD, id, name, position, managed)
		.run();
}

function member(id: string, roles: string, isBot = 0) {
	db.prepare(
		'INSERT INTO guild_members_cache (guild_id, user_id, username, is_bot, roles) VALUES (?, ?, ?, ?, ?)'
	)
		.bind(GUILD, id, `user${id}`, isBot, roles)
		.run();
}

function refreshed(at: string | null) {
	db.prepare('INSERT INTO guild_cache_metadata (guild_id, members_last_refreshed) VALUES (?, ?)')
		.bind(GUILD, at)
		.run();
}

const counts = async () => {
	const result = await getRoleMemberCounts(db as any, GUILD);
	return result && Object.fromEntries(result.roles.map((r) => [r.name, r.member_count]));
};

beforeEach(() => {
	db = createSqliteD1(schema);
	role(GUILD, '@everyone', 0);
	role(PASSENGER, 'Passenger', 5);
	role(BADGE, 'Wearing Communicator Badge', 9);
	role(BOTS, 'SpaceBot', 20, 1);
});

afterEach(() => db.close());

describe('getRoleMemberCounts', () => {
	it('counts the people holding each role', async () => {
		refreshed('2026-09-26 00:00:00');
		member('1', JSON.stringify([PASSENGER]));
		member('2', JSON.stringify([PASSENGER, BADGE]));
		member('3', JSON.stringify([BADGE]));
		member('4', JSON.stringify([]));

		expect(await counts()).toEqual({ Passenger: 2, 'Wearing Communicator Badge': 2 });
	});

	it('leaves bot accounts out of every count', async () => {
		refreshed('2026-09-26 00:00:00');
		member('1', JSON.stringify([PASSENGER]));
		member('9', JSON.stringify([PASSENGER, BOTS]), 1);

		expect((await counts())?.Passenger).toBe(1);
	});

	it('omits @everyone and integration-managed roles', async () => {
		refreshed('2026-09-26 00:00:00');
		const result = await getRoleMemberCounts(db as any, GUILD);
		const names = result?.roles.map((r) => r.name);
		expect(names).not.toContain('@everyone');
		expect(names).not.toContain('SpaceBot');
	});

	it('does not match a role id that is only a substring of another', async () => {
		// The v_guild_roles view uses LIKE '%"id"%', which is safe only because of
		// the quotes; json_each compares whole values and needs no such care.
		refreshed('2026-09-26 00:00:00');
		member('1', JSON.stringify([`${PASSENGER}9`]));
		expect((await counts())?.Passenger).toBe(0);
	});

	it('skips a member whose roles JSON is broken instead of failing the query', async () => {
		refreshed('2026-09-26 00:00:00');
		member('1', JSON.stringify([PASSENGER]));
		member('2', '[not json');
		expect((await counts())?.Passenger).toBe(1);
	});

	it('orders roles by position, highest first, as Discord lists them', async () => {
		refreshed('2026-09-26 00:00:00');
		const result = await getRoleMemberCounts(db as any, GUILD);
		expect(result?.roles.map((r) => r.name)).toEqual([
			'Wearing Communicator Badge',
			'Passenger',
		]);
	});

	it('reports when the member cache was filled', async () => {
		refreshed('2026-09-26 03:00:00');
		expect((await getRoleMemberCounts(db as any, GUILD))?.refreshedAt).toBe(
			'2026-09-26 03:00:00'
		);
	});

	it('returns null, not zeroes, when the member cache has never been filled', async () => {
		// Without the Server Members intent the cache is empty, so every role
		// would count 0 — a false figure, not a small one.
		expect(await getRoleMemberCounts(db as any, GUILD)).toBeNull();
		refreshed(null);
		expect(await getRoleMemberCounts(db as any, GUILD)).toBeNull();
	});

	it('returns null without a database, and when the query fails', async () => {
		expect(await getRoleMemberCounts(null as any, GUILD)).toBeNull();
		const broken = {
			prepare: () => ({
				bind: () => ({
					first: async () => {
						throw new Error('D1 down');
					},
				}),
			}),
		};
		expect(await getRoleMemberCounts(broken as any, GUILD)).toBeNull();
	});
});
