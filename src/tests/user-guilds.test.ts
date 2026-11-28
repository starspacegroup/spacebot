import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1';
import {
	STANDINGS,
	clearRecordThrottle,
	peopleCounts,
	peopleOfServer,
	recordUserGuilds,
	serversOfUser,
	standingOf,
} from '../lib/server/user-guilds';

const SCHEMA = `
${readFileSync('migrations/0104_user_guilds.sql', 'utf8')}
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, global_name TEXT, avatar TEXT, banned INTEGER DEFAULT 0);
CREATE TABLE guild_metadata (guild_id TEXT PRIMARY KEY, name TEXT, icon TEXT);`;

const ADMIN = String(1 << 3);
const MANAGE = String(1 << 5);

describe('standingOf', () => {
	it('reads Discord flags, strongest first', () => {
		expect(standingOf({ id: '1', owner: true, permissions: '0' })).toBe('owner');
		expect(standingOf({ id: '1', permissions: ADMIN })).toBe('admin');
		expect(standingOf({ id: '1', permissions: MANAGE })).toBe('manager');
		expect(standingOf({ id: '1', permissions: '1024' })).toBe('member');
		expect(standingOf({ id: '1', permissions: 'garbage' })).toBe('member');
		expect(standingOf({ id: '1' })).toBe('member');
	});

	it('owner always wins and a plain member never gets more', () => {
		fc.assert(
			fc.property(
				fc.bigInt({ min: 0n, max: (1n << 40n) - 1n }),
				fc.boolean(),
				(bits, owner) => {
					const s = standingOf({ id: '1', owner, permissions: bits.toString() });
					const expected = owner
						? 'owner'
						: bits & (1n << 3n)
							? 'admin'
							: bits & (1n << 5n)
								? 'manager'
								: 'member';
					return s === expected && STANDINGS.includes(s);
				}
			)
		);
	});
});

describe('recording and reading', () => {
	let db: any;
	beforeEach(() => {
		clearRecordThrottle();
		db = createSqliteD1(SCHEMA);
	});
	const bot = new Set(['100', '200']);
	const at = Date.parse('2026-11-21T10:00:00Z');

	it('keeps only servers the bot is in, and reads them back by user and by server', async () => {
		await db.prepare(`INSERT INTO users (id, username) VALUES ('7', 'davis')`).run();
		await db
			.prepare(`INSERT INTO guild_metadata (guild_id, name) VALUES ('100', 'Alpha')`)
			.run();
		await recordUserGuilds(
			db,
			'7',
			[
				{ id: '100', owner: true },
				{ id: '200', permissions: MANAGE },
				{ id: '300', permissions: ADMIN },
			],
			bot,
			at
		);
		const mine = await serversOfUser(db, '7');
		expect(mine.map((m) => [m.guild_id, m.standing, m.name])).toEqual([
			['100', 'owner', 'Alpha'],
			['200', 'manager', null],
		]);
		const people = await peopleOfServer(db, '100');
		expect(people).toHaveLength(1);
		expect(people[0]).toMatchObject({ user_id: '7', standing: 'owner', username: 'davis' });
		expect((await peopleCounts(db)).get('200')).toEqual({
			owner: 0,
			admin: 0,
			manager: 1,
			member: 0,
		});
	});

	it('is throttled per person, and drops a server the person left', async () => {
		await recordUserGuilds(db, '7', [{ id: '100' }, { id: '200' }], bot, at);
		expect(await recordUserGuilds(db, '7', [{ id: '100' }], bot, at + 60_000)).toEqual({
			skipped: true,
		});
		expect((await serversOfUser(db, '7')).length).toBe(2);
		await recordUserGuilds(db, '7', [{ id: '100' }], bot, at + 2 * 3_600_000);
		expect((await serversOfUser(db, '7')).map((m) => m.guild_id)).toEqual(['100']);
	});

	it('does not wipe what it knows when Discord returns nothing', async () => {
		await recordUserGuilds(db, '7', [{ id: '100' }], bot, at);
		clearRecordThrottle();
		await recordUserGuilds(db, '7', [], bot, at + 2 * 3_600_000);
		expect((await serversOfUser(db, '7')).length).toBe(1);
	});

	it('updates a standing that changed and keeps when it was first seen', async () => {
		await recordUserGuilds(db, '7', [{ id: '100', permissions: '0' }], bot, at);
		clearRecordThrottle();
		await recordUserGuilds(
			db,
			'7',
			[{ id: '100', permissions: ADMIN }],
			bot,
			at + 2 * 3_600_000
		);
		const [row] = await serversOfUser(db, '7');
		expect(row.standing).toBe('admin');
		expect(row.first_seen_at).toBe('2026-11-21 10:00:00');
		expect(row.seen_at).toBe('2026-11-21 12:00:00');
	});

	it('ignores bad input and never throws', async () => {
		expect(await recordUserGuilds(null, '7', [{ id: '100' }], bot)).toEqual({ skipped: true });
		expect(await recordUserGuilds(db, undefined, [{ id: '100' }], bot)).toEqual({
			skipped: true,
		});
		expect(await recordUserGuilds(db, "7'; DROP TABLE users;--", [{ id: '100' }], bot)).toEqual(
			{
				skipped: true,
			}
		);
		const broken = {
			batch: async () => Promise.reject(new Error('boom')),
			prepare: () => ({ bind: () => ({}) }),
		};
		expect(await recordUserGuilds(broken, '8', [{ id: '100' }], bot)).toEqual({
			skipped: true,
		});
	});
});
